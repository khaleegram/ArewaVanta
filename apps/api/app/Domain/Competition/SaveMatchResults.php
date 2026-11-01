<?php

namespace App\Domain\Competition;

use App\Domain\Notifications\AdminActivity;
use App\Domain\Scoring\ScoringEngine;
use App\Domain\Scoring\ScoringRules;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\MatchPlayerResult;
use App\Models\MatchResult;
use App\Models\MatchSquadResult;
use App\Models\Player;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class SaveMatchResults
{
    public function __construct(
        private readonly ScoringEngine $scoring,
        private readonly ResultPermissions $permissions,
        private readonly AdminActivity $notifications,
    ) {}

    /** @param list<array<string, mixed>> $rows */
    public function handle(User $actor, CompetitionMatch $match, array $rows, bool $checkVersion = false, ?int $expectedLockVersion = null, bool $checkScoringVersion = false, ?string $expectedScoringVersionId = null, bool $patchMode = false): MatchResult
    {
        return DB::transaction(function () use ($actor, $match, $rows, $checkVersion, $expectedLockVersion, $checkScoringVersion, $expectedScoringVersionId, $patchMode): MatchResult {
            CompetitionEvent::query()->lockForUpdate()->findOrFail($match->day()->value('event_id'));
            $match = CompetitionMatch::query()->with(['day.event', 'squadEntries.squad', 'currentResult.squadResults.playerResults.player'])
                ->lockForUpdate()->findOrFail($match->id);
            $event = $match->day->event;
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $entries = $match->squadEntries->where('entry_status', 'expected');
            $input = collect($rows)->keyBy('squad_id');
            if ($input->keys()->diff($entries->pluck('squad_id'))->isNotEmpty()) {
                throw ValidationException::withMessages(['results' => 'Every result must belong to a squad assigned to this match.']);
            }

            $rules = ScoringRules::fromArray($match->rules_snapshot['rules']);
            $previous = $match->currentResult;
            $legacyResult = $match->resultRecords()->whereIn('status', ['draft', 'revision_draft', 'submitted'])
                ->where('revision_number', '>', $previous?->revision_number ?? 0)
                ->with('squadResults.playerResults.player')->reorder()->orderByDesc('revision_number')->first();
            $revision = $legacyResult ?? $previous;
            if ($checkVersion) {
                $actualLockVersion = $revision?->lock_version;
                $matchesVersion = $actualLockVersion === null
                    ? $expectedLockVersion === null
                    : $expectedLockVersion !== null && $expectedLockVersion === $actualLockVersion;

                abort_unless($matchesVersion, 409, 'These results changed after you opened this sheet. Reload the latest results before saving.');
            }
            if ($checkScoringVersion && $expectedScoringVersionId !== ($match->rules_snapshot['version_id'] ?? null)) {
                abort(409, 'Scoring changed after you opened this sheet. Reload the latest results before saving.');
            }
            if ($revision === null) {
                $revision = MatchResult::query()->create([
                    'match_id' => $match->id,
                    'revision_number' => ((int) $match->resultRecords()->max('revision_number')) + 1,
                    'status' => 'published',
                    'idempotency_key' => (string) Str::ulid(),
                    'authored_by' => $actor->id,
                    'published_at' => now(),
                    'lock_version' => 1,
                    'rules_snapshot' => $match->rules_snapshot,
                ]);
            } else {
                MatchPlayerResult::query()->where('revision_id', $revision->id)->delete();
                MatchSquadResult::query()->where('revision_id', $revision->id)->delete();
                $revision->forceFill(['lock_version' => $revision->lock_version + 1, 'status' => 'published', 'authored_by' => $actor->id, 'published_at' => now(), 'rules_snapshot' => $match->rules_snapshot])->save();
            }
            // Missing rows in a partial update keep their last saved values.
            $previousRows = ($legacyResult ?? $previous)?->squadResults->keyBy('squad_id') ?? collect();
            $seenPlayers = [];
            foreach ($entries as $entry) {
                $previousResult = $previousRows->get($entry->squad_id);
                $row = $input->get($entry->squad_id);
                if ($row === null && $patchMode && $previousResult !== null) {
                    $row = [
                        'status' => $previousResult->participation_status,
                        'placement' => $previousResult->placement,
                        'team_kills' => $previousResult->team_kills_override,
                        'players' => $previousResult->playerResults->map(fn ($player): array => [
                            'player_id' => $player->player_id, 'kills' => $player->kills,
                        ])->all(),
                    ];
                }
                $status = $row === null ? 'absent' : ($row['status'] ?? 'present');
                $present = $status === 'present';
                $placement = $present ? ($row['placement'] ?? null) : null;
                $teamKills = $present ? ($row['team_kills'] ?? null) : null;
                $players = $present ? ($row['players'] ?? []) : [];
                $previousPlayers = $previousResult?->playerResults->keyBy('player_id') ?? collect();
                $resolved = [];
                $individualKills = 0;
                $allKillsKnown = $players !== [];

                foreach ($players as $playerInput) {
                    if (filled($playerInput['player_id'] ?? null)) {
                        // Actual match participants may be guests or last-minute substitutions.
                        // Recording a guest never transfers their clan or permanent roster.
                        $player = Player::query()->findOrFail($playerInput['player_id']);
                    } else {
                        $ign = trim($playerInput['ign'] ?? '');
                        if ($ign === '') {
                            continue;
                        }
                        // Reuse an exact clan name where unambiguous (including retried saves).
                        $candidates = Player::query()->where('clan_id', $entry->squad->clan_id)
                            ->where('current_ign', $ign)->get();
                        $player = $candidates->count() === 1 ? $candidates->first() : Player::query()->create([
                            'clan_id' => $entry->squad->clan_id, 'current_ign' => $ign, 'status' => 'active',
                        ]);
                    }
                    if (isset($seenPlayers[$player->id])) {
                        throw ValidationException::withMessages(['results' => $player->current_ign.' is selected twice. Move them to the squad they played for so their kills are counted once.']);
                    }
                    $seenPlayers[$player->id] = true;
                    $playerKills = $playerInput['kills'] ?? null;
                    $allKillsKnown = $allKillsKnown && $playerKills !== null;
                    $individualKills += (int) $playerKills;
                    $resolved[] = ['player' => $player, 'kills' => $playerKills];
                }
                // A provisional team total may be kept while player details are unknown.
                // If individual kills exceed it, use their sum and leave a visible warning.
                $kills = max($individualKills, (int) $teamKills);
                try {
                    $score = $present ? $this->scoring->score($kills, $placement, $rules) : null;
                } catch (\InvalidArgumentException $exception) {
                    throw ValidationException::withMessages(['results' => $exception->getMessage().' Leave the placement blank to save the other details now.']);
                }
                $result = MatchSquadResult::query()->create([
                    'revision_id' => $revision->id, 'match_id' => $match->id, 'squad_id' => $entry->squad_id,
                    'squad_name_snapshot' => $previousResult?->squad_name_snapshot ?? $entry->squad->name,
                    'participation_status' => $status, 'placement' => $placement, 'team_kills' => $kills,
                    'team_kills_override' => $teamKills,
                    'kills_confirmed' => ! $present || $teamKills !== null || $allKillsKnown,
                    'kill_points' => $score?->killPoints ?? '0', 'placement_points' => $score?->placementPoints,
                    'placement_multiplier' => $score?->placementMultiplier, 'total_points' => $score?->totalPoints ?? '0',
                ]);
                foreach ($resolved as $participant) {
                    $player = $participant['player'];
                    MatchPlayerResult::query()->create([
                        'revision_id' => $revision->id, 'match_squad_result_id' => $result->id,
                        'player_id' => $player->id,
                        'ign_snapshot' => $previousPlayers->get($player->id)?->ign_snapshot ?? $player->current_ign,
                        'kills' => $participant['kills'],
                    ]);
                }
            }
            $match->forceFill(['current_published_revision_id' => $revision->id, 'result_status' => 'published'])->save();
            $clanIds = $entries
                ->when($patchMode, fn ($entries) => $entries->whereIn('squad_id', $input->keys()))
                ->map(static fn ($entry) => $entry->squad?->clan_id)
                ->filter()
                ->unique()
                ->values()
                ->all();
            $this->notifications->notifyClanCaptains(
                $clanIds,
                'Match '.$match->match_index.' results for '.$event->title.' have been updated. Check your squad standings.',
                '/leaderboard?type=squads&event='.rawurlencode($event->slug),
                'results-'.$match->id,
            );

            return $revision->load(['squadResults.squad.clan.squads:id,clan_id', 'squadResults.playerResults']);
        });
    }
}
