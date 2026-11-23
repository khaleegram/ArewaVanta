<?php

namespace App\Domain\Competition\Assistant;

use App\Domain\Competition\BuildEventStandings;
use App\Domain\Competition\ClanTag;
use App\Domain\Competition\PlayerNameSearch;
use App\Domain\Competition\ResultPermissions;
use App\Domain\Competition\SaveMatchResults;
use App\Domain\Scoring\ScoringEngine;
use App\Domain\Scoring\ScoringRules;
use App\Models\AssistantMessage;
use App\Models\AssistantProposal;
use App\Models\AssistantThread;
use App\Models\AuditLog;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\Player;
use App\Models\PlayerAlias;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Throwable;

final class AssistantProposals
{
    public function __construct(
        private readonly ScoringEngine $scoring,
        private readonly AssistantContext $context,
        private readonly SaveMatchResults $save,
        private readonly ResultPermissions $permissions,
        private readonly AssistantPlayerResolver $directory,
        private readonly BuildEventStandings $standings,
    ) {}

    /** @param array<string, mixed> $context
     * @return list<string>
     */
    public function prepare(AssistantThread $thread, AssistantMessage $message, mixed $corrections, array $context): array
    {
        $built = $this->build($thread, $message, $corrections, $context);
        foreach ($built['proposals'] as $proposal) {
            $thread->proposals()->create($proposal);
        }

        return $built['warnings'];
    }

    /** Build immutable previews without creating profiles or changing results.
     * @return array{proposals: list<array<string, mixed>>, warnings: list<string>}
     */
    public function build(AssistantThread $thread, AssistantMessage $message, mixed $corrections, array $context): array
    {
        $prepared = [];
        $warnings = [];
        if (! is_array($corrections) || ! array_is_list($corrections) || count($corrections) > 300) {
            return ['proposals' => [], 'warnings' => ['The AI returned an invalid correction list. No changes were prepared.']];
        }
        $matches = collect($context['matches'])->keyBy('id');
        $profiles = collect($context['players'])->keyBy('id');
        $evidenceIds = $thread->evidence()->whereNotNull('observations')->pluck('id')->all();
        $groups = collect($corrections)->groupBy(fn ($item): string => is_array($item) && is_string($item['match_id'] ?? null) ? $item['match_id'] : 'unknown');
        foreach ($groups as $matchId => $items) {
            try {
                $match = $matches->get($matchId);
                if ($match === null) {
                    throw new InvalidArgumentException('A suggested correction refers to a game that was not loaded. Select that game and ask again.');
                }
                $rows = [];
                $previews = [];
                $identities = [];
                $reasons = [];
                $sources = [];
                $learn = [];
                foreach ($items as $item) {
                    if (! is_array($item)) {
                        throw new InvalidArgumentException('The AI returned an invalid correction. Ask it to review that game again.');
                    }
                    $this->validate($item, $evidenceIds);
                    foreach ($item['changes']['player_updates'] ?? [] as $update) {
                        if (! empty($update['player_id']) && ! empty($update['seen_as']) && ! ($update['remove'] ?? false)) {
                            $learn[$update['player_id'].'|'.$update['seen_as']] = ['player_id' => $update['player_id'], 'seen_as' => $update['seen_as']];
                        }
                    }
                    $entry = collect($match['entries'])->firstWhere('squad_id', $item['squad_id']);
                    if ($entry === null) {
                        throw new InvalidArgumentException('A suggested slot is not assigned to this game. Add or correct the slot in Match desk first.');
                    }
                    if (isset($rows[$entry['squad_id']])) {
                        throw new InvalidArgumentException('The AI suggested conflicting edits for the same slot. Ask it to combine them.');
                    }
                    $before = collect($match['results'])->firstWhere('squad_id', $entry['squad_id']) ?? [
                        'squad_id' => $entry['squad_id'], 'status' => 'unentered', 'placement' => null,
                        'team_kills' => null, 'team_kills_override' => null, 'total_points' => '0', 'players' => [],
                    ];
                    [$row, $after, $players] = $this->patch($before, $item['changes'], $match['rules']['rules']);
                    if ($this->comparable($before) === $this->comparable($after)) {
                        continue;
                    }
                    $rows[$entry['squad_id']] = $row;
                    $rowWarnings = [];
                    if ($row['team_kills'] !== null && $after['known_player_kills'] > $row['team_kills']) {
                        $rowWarnings[] = 'Player kills add up to '.$after['known_player_kills'].', above the proposed team total of '.$row['team_kills'].'. The preview uses the player sum.';
                    }
                    if (count($row['players']) > ($context['event']['squad_size'] ?? 4)) {
                        $rowWarnings[] = 'More players are listed than the usual team size. Check for a mistaken identity or a participant who should be removed.';
                    }
                    $previews[] = [
                        'squad_id' => $entry['squad_id'], 'clan' => $entry['clan'], 'slot' => $entry['slot'],
                        'source_team_number' => $entry['source_team_number'],
                        'before' => $before, 'after' => $after, 'warnings' => $rowWarnings,
                    ];
                    $identities = [...$identities, ...$players];
                    $reasons[] = $item['reason'];
                    $sources = [...$sources, ...($item['evidence_ids'] ?? [])];
                }
                if ($rows === []) {
                    continue;
                }
                $combined = collect($match['results'])->keyBy('squad_id')->replace(collect($rows));
                $entries = collect($match['entries'])->keyBy('squad_id');
                $seen = [];
                foreach ($combined as $row) {
                    if ($row['status'] !== 'present') {
                        continue;
                    }
                    foreach ($row['players'] as $player) {
                        $identity = $player['player_id'] ?? ('new:'.$player['clan_id'].':'.PlayerNameSearch::key($player['ign']));
                        $name = $player['ign'] ?? $profiles->get($player['player_id'])['name'] ?? 'This player';
                        $slot = $entries->get($row['squad_id'])['slot'] ?? 'unknown';
                        if (isset($seen[$identity])) {
                            throw new InvalidArgumentException($name.' appears in slots '.$seen[$identity].' and '.$slot.'. Confirm the one slot they actually played in before accepting.');
                        }
                        $seen[$identity] = $slot;
                    }
                }
                $prepared[] = [
                    'message_id' => $message->id, 'match_id' => $matchId, 'status' => 'pending',
                    'title' => $match['date'].' · Game '.$match['game'].' · '.$match['map'],
                    'reason' => implode("\n", array_unique($reasons)),
                    'payload' => [
                        'rows' => array_values($rows), 'match_signature' => $match['signature'],
                        'expected_lock_version' => $match['lock_version'],
                        'expected_scoring_version_id' => $match['rules']['version_id'] ?? null,
                        'learn_aliases' => array_values($learn),
                        'identities' => collect($identities)->unique('id')->sortBy('id')->values()->all(),
                        'new_players' => collect($rows)->flatMap(fn ($row): array => $row['players'])->filter(fn ($p): bool => empty($p['player_id']))->values()->all(),
                    ],
                    'preview' => ['rows' => $previews, 'evidence_ids' => array_values(array_unique($sources)),
                        'standings' => $this->standingsImpact($thread, $matchId, ['rows' => array_values($rows), 'expected_lock_version' => $match['lock_version']], $entries)],
                ];
            } catch (ValidationException $exception) {
                $warnings[] = 'No correction prepared for this game: '.collect($exception->errors())->flatten()->first();
            } catch (InvalidArgumentException $exception) {
                $warnings[] = $exception->getMessage();
            }
        }

        return ['proposals' => $prepared, 'warnings' => array_values(array_unique($warnings))];
    }

    /** @param array<string, mixed> $item
     * @param  list<string>  $evidenceIds
     */
    private function validate(array $item, array $evidenceIds): void
    {
        Validator::make($item, [
            'match_id' => ['required', 'ulid'], 'squad_id' => ['required', 'ulid'],
            'reason' => ['required', 'string', 'max:4000'],
            'evidence_ids' => ['sometimes', 'array', 'list', 'max:24'],
            'evidence_ids.*' => ['required', Rule::in($evidenceIds)],
            'changes' => ['required', 'array:status,placement,team_kills,player_updates', 'min:1'],
            'changes.status' => ['sometimes', Rule::in(['present', 'absent', 'unentered'])],
            'changes.placement' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
            'changes.team_kills' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:999'],
            'changes.player_updates' => ['sometimes', 'array', 'list', 'max:100'],
            'changes.player_updates.*' => ['required', 'array:player_id,kills,remove,create_player,ign,clan_id,seen_as'],
            'changes.player_updates.*.seen_as' => ['sometimes', 'nullable', 'string', 'max:100'],
            'changes.player_updates.*.player_id' => ['sometimes', 'nullable', 'ulid', 'distinct:strict'],
            'changes.player_updates.*.kills' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:999'],
            'changes.player_updates.*.remove' => ['sometimes', 'boolean'],
            'changes.player_updates.*.create_player' => ['sometimes', 'boolean'],
            'changes.player_updates.*.ign' => ['sometimes', 'string', 'max:100'],
            'changes.player_updates.*.clan_id' => ['sometimes', 'nullable', 'ulid'],
        ])->validate();
    }

    /** @param array<string, mixed> $before
     * @param  array<string, mixed>  $changes
     * @param  array<string, mixed>  $rules
     * @return array{array<string, mixed>, array<string, mixed>, list<array<string, mixed>>}
     */
    private function patch(array $before, array $changes, array $rules): array
    {
        $row = [
            'squad_id' => $before['squad_id'], 'status' => $changes['status'] ?? ($before['status'] === 'unentered' ? 'present' : $before['status']),
            'placement' => array_key_exists('placement', $changes) ? $changes['placement'] : $before['placement'],
            'team_kills' => array_key_exists('team_kills', $changes) ? $changes['team_kills'] : $before['team_kills'],
            'players' => collect($before['players'])->map(fn ($p): array => ['player_id' => $p['player_id'], 'kills' => $p['kills']])->all(),
        ];
        $row['placement'] = $row['placement'] === null ? null : (int) $row['placement'];
        $row['team_kills'] = $row['team_kills'] === null ? null : (int) $row['team_kills'];
        $labels = collect($before['players'])->keyBy('player_id');
        $players = collect($row['players'])->keyBy('player_id');
        $identities = [];
        $clans = Clan::query()->get(['id', 'tag', 'tags'])->keyBy('id');
        $tags = $clans->flatMap(fn ($clan): array => $clan->tagList())->all();
        foreach ($changes['player_updates'] ?? [] as $index => $update) {
            $id = $update['player_id'] ?? null;
            if (($update['remove'] ?? false) && $id === null) {
                throw new InvalidArgumentException('Removing a participant requires their existing profile.');
            }
            if ($id !== null) {
                $player = Player::query()->find($id);
                if ($player === null) {
                    throw new InvalidArgumentException('A suggested player no longer exists. Ask the assistant to find the current profile.');
                }
                $identities[] = $this->identity($player);
            } else {
                if (! ($update['create_player'] ?? false) || ! isset($update['ign']) || ! array_key_exists('clan_id', $update) || ($update['clan_id'] !== null && ! $clans->has($update['clan_id']))) {
                    throw new InvalidArgumentException('An unresolved player needs an existing profile or an explicit new name (clan may be unknown). Team totals can still be corrected separately.');
                }
                $ign = ClanTag::strip(trim($update['ign']), $tags);
                if ($ign === '' || PlayerNameSearch::key($ign) === '') {
                    throw new InvalidArgumentException('A new profile needs a readable player name.');
                }
                $existing = Player::query()->where('clan_id', $update['clan_id'])->get()
                    ->filter(fn ($p): bool => PlayerNameSearch::key(ClanTag::strip($p->current_ign, $tags)) === PlayerNameSearch::key($ign));
                if ($existing->count() > 1) {
                    throw new InvalidArgumentException('Multiple existing profiles match '.$ign.'. Choose the correct profile before adding player details.');
                }
                $player = $existing->first();
                $id = $player?->id;
                if ($player !== null) {
                    $identities[] = $this->identity($player);
                }
            }
            $key = $id ?? 'new:'.$index;
            if ($update['remove'] ?? false) {
                $players->forget($key);
                $labels->forget($key);

                continue;
            }
            $kills = array_key_exists('kills', $update) ? $update['kills'] : ($players->get($key)['kills'] ?? null);
            $kills = $kills === null ? null : (int) $kills;
            $players->put($key, $id !== null ? ['player_id' => $id, 'kills' => $kills] : ['ign' => $ign, 'clan_id' => $update['clan_id'], 'kills' => $kills]);
            $labels->put($key, [
                'player_id' => $id, 'ign' => $labels->get($key)['ign'] ?? $player?->current_ign ?? $ign, 'kills' => $kills,
                'clan_id' => $id !== null ? $player->clan_id : $update['clan_id'],
                'clan_tag' => $clans->get($id !== null ? $player->clan_id : $update['clan_id'])?->tag,
                'creates_profile' => $id === null,
            ]);
        }
        if ($row['status'] !== 'present') {
            $row['placement'] = null;
            $row['team_kills'] = null;
            $players = collect();
        }
        $row['players'] = $players->values()->all();
        $known = $players->sum('kills');
        $total = max($known, (int) $row['team_kills']);
        if ($total > 999) {
            throw new InvalidArgumentException('The proposed team kills exceed the supported range. Recheck the digits.');
        }
        $score = $row['status'] === 'present' ? $this->scoring->score($total, $row['placement'] === null ? null : (int) $row['placement'], ScoringRules::fromArray($rules)) : null;
        $killsKnown = $row['team_kills'] !== null || ($players->isNotEmpty() && $players->every(fn ($p): bool => $p['kills'] !== null));
        $after = [
            'squad_id' => $row['squad_id'], 'status' => $row['status'], 'placement' => $row['placement'],
            'team_kills' => $killsKnown ? $total : null, 'known_player_kills' => $known,
            'team_kills_override' => $row['team_kills'], 'total_points' => $score?->totalPoints ?? '0',
            'players' => $players->map(fn ($p, $key): array => [...$labels->get($key), 'kills' => $p['kills']])->values()->all(),
        ];

        return [$row, $after, $identities];
    }

    /** @return array<string, mixed> */
    private function identity(Player $player): array
    {
        return ['id' => $player->id, 'ign' => $player->current_ign, 'clan_id' => $player->clan_id, 'status' => $player->status];
    }

    /** @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function comparable(array $row): array
    {
        return [
            'status' => $row['status'], 'placement' => $row['placement'], 'team_kills' => $row['team_kills'],
            'players' => collect($row['players'])->map(fn ($p): array => [
                'id' => $p['player_id'] ?? $p['ign'], 'kills' => $p['kills'],
            ])->sortBy('id')->values()->all(),
        ];
    }

    public function decide(User $actor, AssistantThread $thread, AssistantProposal $proposal, string $decision): void
    {
        DB::transaction(function () use ($actor, $thread, $proposal, $decision): void {
            $thread = AssistantThread::query()->lockForUpdate()->findOrFail($thread->id);
            abort_unless((string) $thread->user_id === (string) $actor->id, 404);
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($thread->event_id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            abort_if($thread->processing_token !== null && $thread->processing_started_at?->isAfter(now()->subSeconds(2 * (int) config('services.deepseek.timeout', 90) + 45)), 409, 'Wait for the current review to finish before accepting a correction.');
            $proposal = AssistantProposal::query()->where('thread_id', $thread->id)->lockForUpdate()->findOrFail($proposal->id);
            $status = $decision === 'accept' ? 'accepted' : 'rejected';
            if ($proposal->status === $status) {
                return;
            }
            abort_unless($proposal->status === 'pending', 409, 'This proposal is no longer pending. Ask the assistant for a fresh review.');
            if ($decision === 'accept') {
                $created = [];
                $this->applyPrepared($actor, $event, $proposal, $created);
            }
            $proposal->forceFill(['status' => $status, 'decided_at' => now()])->save();
            $thread->touch();
        });
    }

    /**
     * Rank and point changes if this proposal were accepted. The real save runs inside a transaction
     * that is always rolled back, so the projection uses the exact scoring and tie-break rules.
     *
     * @param  array<string, mixed>  $payload
     * @param  Collection<string, array<string, mixed>>  $entries
     * @return array<string, mixed>|null
     */
    private function standingsImpact(AssistantThread $thread, string $matchId, array $payload, $entries): ?array
    {
        try {
            $actor = User::query()->findOrFail($thread->user_id);
            $match = CompetitionMatch::query()->with('day.event')->findOrFail($matchId);
            $before = $this->standingsMap($match);
            DB::beginTransaction();
            try {
                $rows = $payload['rows'];
                $created = [];
                foreach ($rows as $rowIndex => $row) {
                    foreach ($row['players'] as $playerIndex => $participant) {
                        if (! empty($participant['player_id'])) {
                            continue;
                        }
                        $key = $this->newPlayerKey($participant);
                        $created[$key] ??= Player::query()->create(['clan_id' => $participant['clan_id'], 'current_ign' => $participant['ign'], 'status' => 'active'])->id;
                        $rows[$rowIndex]['players'][$playerIndex] = ['player_id' => $created[$key], 'kills' => $participant['kills'] ?? null];
                    }
                }
                $this->save->handle($actor, $match, $rows, checkVersion: true, expectedLockVersion: $payload['expected_lock_version'], patchMode: true, notify: false);
                $after = $this->standingsMap($match->fresh());
            } finally {
                DB::rollBack();
            }
        } catch (Throwable) {
            return null;
        }
        $changes = [];
        foreach ($after as $squadId => $now) {
            $was = $before[$squadId] ?? null;
            if ($was === null || $was['rank'] !== $now['rank'] || $was['points'] !== $now['points']) {
                $changes[] = ['squad_id' => $squadId, 'clan' => $now['clan'], 'slot' => $now['slot'], 'before_rank' => $was['rank'] ?? null, 'after_rank' => $now['rank'],
                    'before_points' => $was['points'] ?? '0', 'after_points' => $now['points'], 'total_kills' => $now['kills']];
            }
        }
        usort($changes, fn (array $a, array $b): int => $a['after_rank'] <=> $b['after_rank']);

        return ['scope' => 'this competition', 'rows' => $changes, 'teams' => count($after)];
    }

    /** @return array<string, array{rank: int, points: string, kills: int, clan: string, slot: ?int}> */
    private function standingsMap(CompetitionMatch $match): array
    {
        $event = $match->day->event()->first();
        $result = [];
        foreach ($this->standings->handle($event)['standings'] as $row) {
            $result[$row['squad']['id']] = ['rank' => (int) $row['rank'], 'points' => (string) $row['total_points'], 'kills' => (int) $row['total_kills'],
                'clan' => $row['squad']['clan']['name'] ?? $row['squad']['name'], 'slot' => $row['slot_number'] ?? null];
        }

        return $result;
    }

    /**
     * Organizer edits to a pending proposal: placement, team kills and player kills (or removal).
     * The proposal is rebuilt from the edited rows, so previews, warnings and standings stay exact.
     *
     * @param  list<array<string, mixed>>  $edits
     */
    public function edit(User $actor, AssistantThread $thread, AssistantProposal $proposal, array $edits): void
    {
        DB::transaction(function () use ($actor, $thread, $proposal, $edits): void {
            $thread = AssistantThread::query()->lockForUpdate()->findOrFail($thread->id);
            abort_unless((string) $thread->user_id === (string) $actor->id, 404);
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($thread->event_id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $proposal = AssistantProposal::query()->where('thread_id', $thread->id)->lockForUpdate()->findOrFail($proposal->id);
            abort_unless($proposal->status === 'pending' && ! isset($proposal->payload['kind']) && ! isset($proposal->payload['parent_id']), 409, 'Only a pending result correction can be edited.');
            Validator::make(['edits' => $edits], [
                'edits' => ['required', 'array', 'list', 'max:60'],
                'edits.*.squad_id' => ['required', 'ulid'],
                'edits.*.placement' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
                'edits.*.team_kills' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:999'],
                'edits.*.players' => ['sometimes', 'array', 'list', 'max:100'],
                'edits.*.players.*.player_id' => ['sometimes', 'nullable', 'ulid'],
                'edits.*.players.*.ign' => ['sometimes', 'nullable', 'string', 'max:100'],
                'edits.*.players.*.kills' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:999'],
                'edits.*.players.*.remove' => ['sometimes', 'boolean'],
            ])->validate();
            $byRow = collect($edits)->keyBy('squad_id');
            $corrections = [];
            foreach ($proposal->preview['rows'] as $index => $preview) {
                $row = $proposal->payload['rows'][$index];
                $edit = $byRow->get($row['squad_id'], []);
                $players = collect($row['players']);
                foreach ($edit['players'] ?? [] as $change) {
                    $key = fn (array $p): string => ($p['player_id'] ?? null) ?: 'new:'.PlayerNameSearch::key($p['ign'] ?? '');
                    $target = $key($change);
                    $players = $players->map(fn (array $p): array => $key($p) === $target && array_key_exists('kills', $change) ? [...$p, 'kills' => $change['kills']] : $p)
                        ->reject(fn (array $p): bool => $key($p) === $target && ($change['remove'] ?? false))->values();
                }
                $updates = $players->map(fn (array $p): array => ! empty($p['player_id'])
                    ? ['player_id' => $p['player_id'], 'kills' => $p['kills'] ?? null]
                    : ['create_player' => true, 'ign' => $p['ign'], 'clan_id' => $p['clan_id'], 'kills' => $p['kills'] ?? null])->all();
                $kept = collect($updates)->pluck('player_id')->filter()->all();
                foreach ($preview['before']['players'] as $old) {
                    if (! in_array($old['player_id'], $kept, true)) {
                        $updates[] = ['player_id' => $old['player_id'], 'remove' => true];
                    }
                }
                $corrections[] = [
                    'match_id' => $proposal->match_id, 'squad_id' => $row['squad_id'], 'reason' => $proposal->reason ?: 'Organizer edited the proposal.',
                    'evidence_ids' => $proposal->preview['evidence_ids'],
                    'changes' => ['status' => $row['status'], 'placement' => array_key_exists('placement', $edit) ? $edit['placement'] : $row['placement'],
                        'team_kills' => array_key_exists('team_kills', $edit) ? $edit['team_kills'] : $row['team_kills'], 'player_updates' => $updates],
                ];
            }
            $context = $this->context->forEvent($event, $proposal->match_id);
            $message = AssistantMessage::query()->findOrFail($proposal->message_id);
            $built = $this->build($thread, $message, $corrections, $context);
            if ($built['proposals'] === []) {
                throw ValidationException::withMessages(['edits' => $built['warnings'][0] ?? 'These edits would not change anything or are not valid.']);
            }
            $new = $built['proposals'][0];
            $proposal->forceFill(['payload' => $new['payload'], 'preview' => $new['preview'], 'reason' => $proposal->reason])->save();
        });
    }

    /** Restore the saved state captured in the preview, unless anyone edited the game since acceptance. */
    public function undo(User $actor, AssistantThread $thread, AssistantProposal $proposal): void
    {
        DB::transaction(function () use ($actor, $thread, $proposal): void {
            $thread = AssistantThread::query()->lockForUpdate()->findOrFail($thread->id);
            abort_unless((string) $thread->user_id === (string) $actor->id, 404);
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($thread->event_id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $proposal = AssistantProposal::query()->where('thread_id', $thread->id)->lockForUpdate()->findOrFail($proposal->id);
            abort_unless($proposal->status === 'accepted' && ! isset($proposal->payload['kind']), 409, 'Only an accepted result correction can be undone.');
            $match = CompetitionMatch::query()->lockForUpdate()->findOrFail($proposal->match_id);
            $audit = AuditLog::query()->where('action', 'assistant.result_correction.accepted')->where('entity_id', $match->id)
                ->where('after_data->proposal_id', $proposal->id)->latest('id')->first();
            $current = $this->context->forMatch($match)['lock_version'];
            abort_unless($audit !== null && ($audit->after_data['lock_version'] ?? null) === $current, 409, 'This game was edited after the correction, so undoing it would overwrite newer changes. Review the game first.');
            $rows = collect($proposal->preview['rows'])->map(fn (array $row): array => [
                'squad_id' => $row['squad_id'], 'status' => $row['before']['status'], 'placement' => $row['before']['placement'],
                'team_kills' => $row['before']['team_kills_override'],
                'players' => collect($row['before']['players'])->map(fn (array $p): array => ['player_id' => $p['player_id'], 'kills' => $p['kills']])->all(),
            ])->all();
            $result = $this->save->handle($actor, $match, $rows, checkVersion: true, expectedLockVersion: $current, patchMode: true, notify: false);
            AuditLog::query()->create([
                'actor_user_id' => $actor->id, 'action' => 'assistant.result_correction.undone', 'entity_type' => 'match', 'entity_id' => $match->id,
                'before_data' => ['proposal_id' => $proposal->id], 'after_data' => ['proposal_id' => $proposal->id, 'revision_id' => $result->id, 'rows' => $rows],
                'reason' => 'Organizer undid an accepted assistant correction.', 'occurred_at' => now(),
            ]);
            $proposal->forceFill(['status' => 'undone', 'decided_at' => now()])->save();
        });
    }

    /** Called inside an authorized transaction; $created is shared only within one accepted batch.
     * @param  array<string, string>  $created
     */
    public function applyPrepared(User $actor, CompetitionEvent $event, AssistantProposal $proposal, array &$created): void
    {
        $match = CompetitionMatch::query()->lockForUpdate()->findOrFail($proposal->match_id);
        abort_unless($match->day()->value('event_id') === $event->id, 404);
        $current = $this->context->forMatch($match);
        $payload = $proposal->payload;
        abort_unless(hash_equals($payload['match_signature'], $current['signature']), 409, 'Results, scoring or slot assignments changed after this proposal. Ask the assistant to review the latest saved data before accepting.');
        foreach ($payload['identities'] as $identity) {
            $player = Player::query()->lockForUpdate()->find($identity['id']);
            abort_unless($player !== null && $this->identity($player) === $identity, 409, 'A player profile changed after this proposal. Ask for a fresh review.');
        }
        $clans = Clan::query()->get(['id', 'tag', 'tags'])->keyBy('id');
        $tags = $clans->flatMap(fn ($clan): array => $clan->tagList())->all();
        $this->directory->load();
        foreach ($payload['new_players'] ?? [] as $newPlayer) {
            abort_unless(($newPlayer['clan_id'] === null || $clans->has($newPlayer['clan_id'])) && ClanTag::strip($newPlayer['ign'], $tags) === $newPlayer['ign'], 409, 'The new player’s clan or name interpretation changed. Ask for a fresh review.');
            if (isset($created[$this->newPlayerKey($newPlayer)])) {
                continue;
            }
            $resolved = $this->directory->resolve($newPlayer['ign'], true);
            abort_if(isset($resolved['player_id']) || isset($resolved['candidates']), 409, 'An existing profile, including an inactive profile, may match '.$newPlayer['ign'].'. Ask for a fresh player review before creating another profile.');
            $existing = Player::query()->where('clan_id', $newPlayer['clan_id'])->lockForUpdate()->get()
                ->contains(fn ($p): bool => PlayerNameSearch::key(ClanTag::strip($p->current_ign, $tags)) === PlayerNameSearch::key($newPlayer['ign']));
            abort_if($existing, 409, 'A matching player profile was created after this proposal. Ask the assistant to reuse the existing profile.');
        }
        $rows = $payload['rows'];
        $createdPlayerIds = [];
        foreach ($rows as $rowIndex => $row) {
            foreach ($row['players'] as $playerIndex => $participant) {
                if (! empty($participant['player_id'])) {
                    continue;
                }
                $key = $this->newPlayerKey($participant);
                $player = isset($created[$key]) ? Player::query()->findOrFail($created[$key]) : Player::query()->create([
                    'clan_id' => $participant['clan_id'],
                    'current_ign' => $participant['ign'],
                    'status' => 'active',
                ]);
                if (! isset($created[$key])) {
                    $createdPlayerIds[] = $player->id;
                    $created[$key] = $player->id;
                }
                $rows[$rowIndex]['players'][$playerIndex] = [
                    'player_id' => $player->id,
                    'kills' => $participant['kills'] ?? null,
                ];
            }
        }
        $result = $this->save->handle(
            $actor, $match, $rows, checkVersion: true, expectedLockVersion: $payload['expected_lock_version'],
            checkScoringVersion: true, expectedScoringVersionId: $payload['expected_scoring_version_id'], patchMode: true,
        );
        $this->learnAliases($payload['learn_aliases'] ?? []);
        AuditLog::query()->create([
            'actor_user_id' => $actor->id, 'action' => 'assistant.result_correction.accepted',
            'entity_type' => 'match', 'entity_id' => $match->id,
            'before_data' => ['proposal_id' => $proposal->id, 'rows' => array_column($proposal->preview['rows'], 'before')],
            'after_data' => ['proposal_id' => $proposal->id, 'revision_id' => $result->id, 'lock_version' => $result->lock_version, 'rows' => array_column($proposal->preview['rows'], 'after'), 'evidence_ids' => $proposal->preview['evidence_ids'], 'created_player_ids' => $createdPlayerIds],
            'reason' => $proposal->reason, 'occurred_at' => now(),
        ]);

    }

    /** @param array<string, mixed> $player */
    private function newPlayerKey(array $player): string
    {
        return ($player['clan_id'] ?? '').':'.PlayerNameSearch::key($player['ign']);
    }

    /**
     * Remember how a screenshot spelled a player the organizer accepted, so the next read of that
     * spelling is an exact match. Only differing spellings are stored.
     *
     * @param  list<array{player_id: string, seen_as: string}>  $learned
     */
    private function learnAliases(array $learned): void
    {
        $tags = Clan::query()->get(['id', 'tag', 'tags'])->flatMap(fn ($clan): array => $clan->tagList())->all();
        foreach ($learned as $item) {
            $player = Player::query()->find($item['player_id']);
            $key = PlayerNameSearch::key(ClanTag::strip($item['seen_as'], $tags));
            if ($player === null || $key === '' || $key === PlayerNameSearch::key($player->current_ign) || mb_strlen($item['seen_as']) > 100) {
                continue;
            }
            PlayerAlias::query()->firstOrCreate(['player_id' => $player->id, 'alias_key' => $key], ['alias' => $item['seen_as'], 'source' => 'screenshot']);
        }
    }
}
