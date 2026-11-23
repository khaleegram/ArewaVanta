<?php

namespace App\Domain\Competition\Assistant;

use App\Domain\Competition\AssignPlayerSquad;
use App\Domain\Competition\ChangeMatchScoring;
use App\Domain\Competition\ClanTag;
use App\Domain\Competition\ClanTagRegistry;
use App\Domain\Competition\ManageCompetitionSlots;
use App\Domain\Competition\OrganizationPermissions;
use App\Domain\Competition\PlayerNameSearch;
use App\Domain\Competition\ResultPermissions;
use App\Domain\Competition\UpdateEventSchedule;
use App\Domain\Directory\MergePlayerProfiles;
use App\Http\Controllers\Api\V1\Manage\MatchLateEntryController;
use App\Http\Controllers\Api\V1\Manage\OrganizationController;
use App\Models\AssistantMessage;
use App\Models\AssistantProposal;
use App\Models\AssistantThread;
use App\Models\AuditLog;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\MatchPlayerResult;
use App\Models\Player;
use App\Models\PlayerAlias;
use App\Models\PlayerWarning;
use App\Models\ScoringRuleVersion;
use App\Models\Squad;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Administrative actions the organizer assistant can propose: slot moves, clan names and tags,
 * player names and aliases, and the warning record. Every action is previewed, accepted once,
 * permission checked again on acceptance, and refused if the data changed after the preview.
 */
final class AssistantAdminActions
{
    private const SEVERITIES = ['note', 'warning', 'final_warning'];

    public function __construct(
        private readonly ManageCompetitionSlots $slots,
        private readonly ResultPermissions $permissions,
        private readonly OrganizationPermissions $organization,
        private readonly ClanTagRegistry $tagRegistry,
        private readonly AssignPlayerSquad $assignSquad,
        private readonly MergePlayerProfiles $mergeProfiles,
        private readonly UpdateEventSchedule $schedule,
        private readonly ChangeMatchScoring $scoring,
    ) {}

    /**
     * @param  array<string, mixed>  $context
     * @return list<string> warnings
     */
    public function prepare(User $actor, AssistantThread $thread, AssistantMessage $message, mixed $actions, array $context): array
    {
        if (! is_array($actions) || ! array_is_list($actions) || $actions === []) {
            return [];
        }
        if (count($actions) > 25) {
            return ['Choose up to 25 administrative actions at a time. Nothing was prepared.'];
        }
        $event = CompetitionEvent::query()->findOrFail($context['event']['id']);
        $items = [];
        $operations = [];
        $warnings = [];
        $slotActions = array_values(array_filter($actions, fn ($a): bool => is_array($a) && in_array($a['type'] ?? null, ['move_slot', 'clear_slot', 'assign_slot'], true)));
        $scheduleActions = array_values(array_filter($actions, fn ($a): bool => is_array($a) && in_array($a['type'] ?? null, ['set_map', 'move_day', 'add_game', 'remove_game'], true)));
        $otherActions = array_values(array_filter($actions, fn ($a): bool => is_array($a) && ! in_array($a['type'] ?? null, ['move_slot', 'clear_slot', 'assign_slot', 'set_map', 'move_day', 'add_game', 'remove_game'], true)));

        if ($scheduleActions !== []) {
            try {
                $built = $this->prepareSchedule($actor, $event, $scheduleActions);
                $items = [...$items, ...$built['items']];
                $operations[] = $built['operation'];
            } catch (InvalidArgumentException $exception) {
                $warnings[] = $exception->getMessage();
            }
        }

        if ($slotActions !== []) {
            try {
                $built = $this->prepareSlots($actor, $event, $slotActions);
                $items = [...$items, ...$built['items']];
                $warnings = [...$warnings, ...$built['warnings']];
                if ($built['operation'] !== null) {
                    $operations[] = $built['operation'];
                }
            } catch (InvalidArgumentException $exception) {
                $warnings[] = $exception->getMessage();
            }
        }
        foreach ($otherActions as $action) {
            try {
                $built = match ($action['type'] ?? null) {
                    'update_clan' => $this->prepareClan($actor, $action),
                    'update_player' => $this->preparePlayer($actor, $action),
                    'record_warning' => $this->prepareWarning($actor, $event, $action),
                    'revoke_warning' => $this->prepareRevoke($actor, $event, $action),
                    'add_roster_player' => $this->prepareRosterAdd($actor, $action),
                    'remove_roster_player' => $this->prepareRosterRemove($actor, $action),
                    'merge_players' => $this->prepareMerge($actor, $action),
                    'set_scoring' => $this->prepareScoring($actor, $event, $action),
                    'late_entry' => $this->prepareLateEntry($actor, $event, $action),
                    'create_squad' => $this->prepareSquad($actor, $action),
                    default => throw new InvalidArgumentException('That administrative action is not supported yet: '.(is_string($action['type'] ?? null) ? $action['type'] : 'unknown').'.'),
                };
                $items = [...$items, ...$built['items']];
                $warnings = [...$warnings, ...($built['warnings'] ?? [])];
                $operations[] = $built['operation'];
            } catch (InvalidArgumentException $exception) {
                $warnings[] = $exception->getMessage();
            } catch (ValidationException $exception) {
                $warnings[] = (string) collect($exception->errors())->flatten()->first();
            }
        }
        if ($operations === []) {
            return $warnings;
        }
        $thread->proposals()->create([
            'message_id' => $message->id, 'match_id' => null, 'status' => 'pending',
            'title' => 'Administrative changes · '.count($items).' item'.(count($items) === 1 ? '' : 's'),
            'reason' => 'Prepared from the organizer’s request. Nothing changes until you accept.',
            'payload' => ['kind' => 'admin_action', 'event_id' => $event->id, 'operations' => $operations],
            'preview' => ['kind' => 'admin_action', 'items' => $items, 'warnings' => array_values(array_unique($warnings)), 'evidence_ids' => [], 'rows' => []],
        ]);

        return array_values(array_unique($warnings));
    }

    /**
     * @param  list<array<string, mixed>>  $actions
     * @return array{items: list<array<string, mixed>>, warnings: list<string>, operation: ?array<string, mixed>}
     */
    private function prepareSlots(User $actor, CompetitionEvent $event, array $actions): array
    {
        $sheet = $this->slots->show($actor, $event);
        if (! $sheet['event']['can_edit']) {
            throw new InvalidArgumentException('This competition already has saved games, so its slots are preserved and cannot be moved here.');
        }
        $capacity = (int) $sheet['event']['capacity'];
        $squads = collect($sheet['squads'])->keyBy('id');
        $working = collect($sheet['slots'])->mapWithKeys(fn (array $slot): array => [
            $slot['slot'] => ['slot' => $slot['slot'], 'squad_id' => $slot['squad_id'], 'reserved_clan_id' => $slot['reserved_clan_id']],
        ]);
        $name = fn (?array $slot): string => $slot === null || ($slot['squad_id'] === null && $slot['reserved_clan_id'] === null) ? 'empty'
            : ($slot['squad_id'] !== null ? trim(($squads->get($slot['squad_id'])['clan']['tag'] ?? '').' '.($squads->get($slot['squad_id'])['name'] ?? 'Squad'))
                : 'reserved for '.(Clan::query()->find($slot['reserved_clan_id'])?->name ?? 'a clan'));
        $slotOf = fn (string $squadId): ?int => $working->first(fn (array $s): bool => $s['squad_id'] === $squadId)['slot'] ?? null;
        $items = [];
        $warnings = [];
        foreach ($actions as $action) {
            $type = $action['type'];
            $to = filter_var($action['to_slot'] ?? $action['slot'] ?? null, FILTER_VALIDATE_INT);
            if (! $to || $to < 1 || $to > $capacity) {
                throw new InvalidArgumentException('Slot numbers must be between 1 and '.$capacity.'.');
            }
            if ($type === 'clear_slot') {
                $items[] = ['label' => 'Clear slot '.$to, 'before' => $name($working->get($to)), 'after' => 'empty'];
                $working->put($to, ['slot' => $to, 'squad_id' => null, 'reserved_clan_id' => null]);

                continue;
            }
            if ($type === 'assign_slot') {
                $squadId = (string) ($action['squad_id'] ?? '');
                if (! $squads->has($squadId)) {
                    throw new InvalidArgumentException('That squad is not available for slot assignment.');
                }
                if ($slotOf($squadId) !== null) {
                    throw new InvalidArgumentException($name(['squad_id' => $squadId, 'reserved_clan_id' => null]).' is already on slot '.$slotOf($squadId).'. Move it instead.');
                }
                if ($name($working->get($to)) !== 'empty') {
                    $warnings[] = 'Slot '.$to.' currently holds '.$name($working->get($to)).'; they will have no slot until reassigned.';
                }
                $items[] = ['label' => 'Assign slot '.$to, 'before' => $name($working->get($to)), 'after' => $name(['squad_id' => $squadId, 'reserved_clan_id' => null])];
                $working->put($to, ['slot' => $to, 'squad_id' => $squadId, 'reserved_clan_id' => null]);

                continue;
            }
            $from = filter_var($action['from_slot'] ?? null, FILTER_VALIDATE_INT) ?: (isset($action['squad_id']) ? $slotOf((string) $action['squad_id']) : null);
            if (! $from || ! $working->has($from) || $name($working->get($from)) === 'empty') {
                throw new InvalidArgumentException('Slot move: the source slot is empty or could not be identified.');
            }
            if ($from === $to) {
                continue;
            }
            $source = $working->get($from);
            $target = $working->get($to);
            $targetName = $name($target);
            if ($targetName !== 'empty' && ($action['swap'] ?? true) === false) {
                throw new InvalidArgumentException('Slot '.$to.' is occupied by '.$targetName.'. Ask for a swap, or clear that slot first.');
            }
            $working->put($to, [...$source, 'slot' => $to]);
            $working->put($from, ['slot' => $from, 'squad_id' => $target['squad_id'] ?? null, 'reserved_clan_id' => $target['reserved_clan_id'] ?? null]);
            $items[] = ['label' => $name($source).': slot '.$from.' → '.$to, 'before' => 'slot '.$from, 'after' => 'slot '.$to];
            if ($targetName !== 'empty') {
                $items[] = ['label' => $targetName.': slot '.$to.' → '.$from, 'before' => 'slot '.$to, 'after' => 'slot '.$from];
            }
        }
        if ($items === []) {
            return ['items' => [], 'warnings' => $warnings, 'operation' => null];
        }
        if ($sheet['event']['permanent']) {
            $warnings[] = 'Slots are permanent for this recurring scrim: the change applies to this weekend and later unscored weekends. Saved games keep their results.';
        }

        return ['items' => $items, 'warnings' => $warnings, 'operation' => [
            'type' => 'set_slots', 'expected_version' => $sheet['version'],
            'slots' => $working->sortKeys()->values()->all(),
            'before_slots' => collect($sheet['slots'])->map(fn (array $slot): array => ['slot' => $slot['slot'], 'squad_id' => $slot['squad_id'], 'reserved_clan_id' => $slot['reserved_clan_id']])->values()->all(),
        ]];
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>}
     */
    private function prepareClan(User $actor, array $action): array
    {
        $clan = Clan::query()->find($action['clan_id'] ?? '');
        if ($clan === null || ! $this->organization->canManageClan($actor, $clan)) {
            throw new InvalidArgumentException('That clan was not found or you cannot manage it.');
        }
        $items = [];
        $operation = ['type' => 'update_clan', 'clan_id' => $clan->id, 'expected_name' => $clan->name, 'expected_tags' => $clan->tagList()];
        $name = isset($action['name']) && is_string($action['name']) ? trim($action['name']) : null;
        if ($name !== null && $name !== $clan->name) {
            if ($name === '' || mb_strlen($name) > 120 || Clan::query()->whereKeyNot($clan->id)->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])->exists()) {
                throw new InvalidArgumentException('A clan with the name “'.$name.'” already exists, or the name is invalid.');
            }
            $operation['name'] = $name;
            $items[] = ['label' => 'Clan name', 'before' => $clan->name, 'after' => $name];
        }
        if (array_key_exists('tags', $action)) {
            $tags = ClanTag::normalizeList($action['tags']);
            if ($tags !== $clan->tagList()) {
                $this->tagRegistry->assertAvailable($tags, $clan->id);
                $operation['tags'] = $tags;
                $items[] = ['label' => 'Clan tags for '.$clan->name, 'before' => implode(', ', $clan->tagList()) ?: 'none', 'after' => implode(', ', $tags) ?: 'none'];
            }
        }
        if ($items === []) {
            throw new InvalidArgumentException('Nothing would change for '.$clan->name.'.');
        }

        return ['items' => $items, 'operation' => $operation];
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>, warnings?: list<string>}
     */
    private function preparePlayer(User $actor, array $action): array
    {
        if (! $this->organization->canManageAll($actor)) {
            throw new InvalidArgumentException('Editing player profiles needs full organizer access.');
        }
        $player = Player::query()->with('clan')->find($action['player_id'] ?? '');
        if ($player === null) {
            throw new InvalidArgumentException('That player profile was not found. Search the directory first.');
        }
        $tags = $player->clan?->tagList() ?? [];
        $items = [];
        $operation = ['type' => 'update_player', 'player_id' => $player->id, 'expected_ign' => $player->current_ign, 'aliases' => []];
        if (isset($action['ign']) && is_string($action['ign'])) {
            $ign = ClanTag::strip(trim($action['ign']), $tags);
            if ($ign === '' || PlayerNameSearch::key($ign) === '' || mb_strlen($ign) > 100) {
                throw new InvalidArgumentException('The new in-game name is not readable.');
            }
            if ($ign !== $player->current_ign) {
                $operation['ign'] = $ign;
                $items[] = ['label' => 'Player name', 'before' => $player->current_ign, 'after' => $ign, 'note' => 'The old name is kept as an alias so searches and old results still find them.'];
            }
        }
        if (isset($action['add_alias']) && is_string($action['add_alias']) && trim($action['add_alias']) !== '') {
            $alias = trim($action['add_alias']);
            $operation['aliases'][] = $alias;
            $items[] = ['label' => 'Alias for '.$player->current_ign, 'before' => '—', 'after' => $alias];
        }
        if ($items === []) {
            throw new InvalidArgumentException('Nothing would change for '.$player->current_ign.'. Permanent clan changes are not made by the assistant.');
        }

        return ['items' => $items, 'operation' => $operation];
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>, warnings: list<string>}
     */
    private function prepareWarning(User $actor, CompetitionEvent $event, array $action): array
    {
        abort_unless($this->permissions->canManage($actor, $event), 403);
        $player = Player::query()->with('clan')->find($action['player_id'] ?? '');
        $reason = is_string($action['reason'] ?? null) ? trim($action['reason']) : '';
        $severity = $action['severity'] ?? 'warning';
        if ($player === null || $reason === '' || mb_strlen($reason) > 2000 || ! in_array($severity, self::SEVERITIES, true)) {
            throw new InvalidArgumentException('A warning needs an existing player, a reason, and a severity of note, warning or final_warning.');
        }
        $active = PlayerWarning::query()->where('player_id', $player->id)->whereNull('revoked_at')->count();
        $matchId = is_string($action['match_id'] ?? null) ? $action['match_id'] : null;

        return [
            'items' => [['label' => ucfirst(str_replace('_', ' ', $severity)).' for '.$player->current_ign, 'before' => $active.' active record'.($active === 1 ? '' : 's'), 'after' => ($active + 1).' active records', 'note' => $reason]],
            'warnings' => $active >= 2 ? [$player->current_ign.' already has '.$active.' active records. Review the history before applying a penalty.'] : [],
            'operation' => ['type' => 'record_warning', 'player_id' => $player->id, 'severity' => $severity, 'reason' => $reason, 'match_id' => $matchId, 'expected_active' => $active],
        ];
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>}
     */
    private function prepareRevoke(User $actor, CompetitionEvent $event, array $action): array
    {
        abort_unless($this->permissions->canManage($actor, $event), 403);
        $warning = PlayerWarning::query()->with('player')->whereNull('revoked_at')->find($action['warning_id'] ?? '');
        if ($warning === null) {
            throw new InvalidArgumentException('That warning was not found or was already revoked.');
        }

        return [
            'items' => [['label' => 'Revoke record for '.$warning->player->current_ign, 'before' => $warning->reason, 'after' => 'revoked']],
            'operation' => ['type' => 'revoke_warning', 'warning_id' => $warning->id, 'reason' => is_string($action['reason'] ?? null) ? mb_substr($action['reason'], 0, 2000) : null],
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $actions
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>}
     */
    private function prepareSchedule(User $actor, CompetitionEvent $event, array $actions): array
    {
        abort_unless($this->permissions->canManage($actor, $event), 403);
        $days = $this->scheduleDays($event);
        $items = [];
        foreach ($actions as $action) {
            if ($action['type'] === 'set_map') {
                $label = is_string($action['map_label'] ?? null) ? trim($action['map_label']) : '';
                $found = null;
                foreach ($days as $d => $day) {
                    foreach ($day['games'] as $g => $game) {
                        if ($game['id'] === ($action['match_id'] ?? null)) {
                            $found = [$d, $g];
                        }
                    }
                }
                if ($found === null || $label === '' || mb_strlen($label) > 80) {
                    throw new InvalidArgumentException('Changing a map needs a game in this competition and a map name.');
                }
                $game = &$days[$found[0]]['games'][$found[1]];
                $items[] = ['label' => $days[$found[0]]['date'].' · Game '.($found[1] + 1).' map', 'before' => $game['map_label'], 'after' => $label];
                $game['map_label'] = $label;
                $game['map_code'] = is_string($action['map_code'] ?? null) && trim($action['map_code']) !== '' ? mb_substr(trim($action['map_code']), 0, 40) : $game['map_code'];
                unset($game);

                continue;
            }
            if ($action['type'] === 'add_game') {
                $label = is_string($action['map_label'] ?? null) ? trim($action['map_label']) : '';
                $index = collect($days)->search(fn (array $day): bool => $day['date'] === ($action['date'] ?? null));
                if ($index === false || $label === '' || mb_strlen($label) > 80 || count($days[$index]['games']) >= 20) {
                    throw new InvalidArgumentException('Adding a game needs an existing day date and a map name.');
                }
                $code = is_string($action['map_code'] ?? null) && trim($action['map_code']) !== '' ? mb_substr(trim($action['map_code']), 0, 40) : ($days[$index]['games'][0]['map_code'] ?? Str::slug($label));
                $days[$index]['games'][] = ['id' => null, 'map_code' => $code, 'map_label' => $label];
                $items[] = ['label' => $days[$index]['date'].' · new Game '.count($days[$index]['games']), 'before' => '—', 'after' => $label, 'note' => 'Uses the competition’s scoring rules and the current slot assignments.'];

                continue;
            }
            if ($action['type'] === 'remove_game') {
                $found = null;
                foreach ($days as $d => $day) {
                    foreach ($day['games'] as $g => $game) {
                        if ($game['id'] === ($action['match_id'] ?? null)) {
                            $found = [$d, $g];
                        }
                    }
                }
                if ($found === null) {
                    throw new InvalidArgumentException('That game is not in this competition.');
                }
                if (CompetitionMatch::query()->findOrFail($days[$found[0]]['games'][$found[1]]['id'])->resultRecords()->exists()) {
                    throw new InvalidArgumentException('That game already has saved results, so it is not removed. Clear the results first if you really want it gone.');
                }
                $items[] = ['label' => $days[$found[0]]['date'].' · Game '.($found[1] + 1), 'before' => $days[$found[0]]['games'][$found[1]]['map_label'], 'after' => 'removed', 'note' => 'Later games on that day move up one number.'];
                array_splice($days[$found[0]]['games'], $found[1], 1);
                if ($days[$found[0]]['games'] === []) {
                    throw new InvalidArgumentException('A day needs at least one game. Move the day or keep one game.');
                }

                continue;
            }
            $from = $action['from_date'] ?? null;
            $to = $action['to_date'] ?? null;
            $index = collect($days)->search(fn (array $day): bool => $day['date'] === $from);
            if ($index === false || ! is_string($to) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) || collect($days)->contains(fn (array $day): bool => $day['date'] === $to)) {
                throw new InvalidArgumentException('Moving a day needs an existing day date and a new, unused date (YYYY-MM-DD).');
            }
            $items[] = ['label' => $days[$index]['label'].' date', 'before' => $from, 'after' => $to, 'note' => 'Saved results stay with their games.'];
            $days[$index]['date'] = $to;
        }
        if ($event->series_id !== null) {
            $dates = collect($days)->pluck('date')->sort()->values();
            if (CarbonImmutable::parse($dates->first())->diffInDays(CarbonImmutable::parse($dates->last())) >= 7) {
                throw new InvalidArgumentException('Keep recurring scrim games within one seven-day week.');
            }
        }

        return ['items' => $items, 'operation' => ['type' => 'set_schedule', 'expected_signature' => $this->scheduleSignature($this->scheduleDays($event)), 'days' => $days, 'before_days' => $this->scheduleDays($event)]];
    }

    /** @return list<array<string, mixed>> */
    private function scheduleDays(CompetitionEvent $event): array
    {
        return $event->days()->with('matches')->orderBy('sort_order')->get()->map(fn ($day): array => [
            'id' => $day->id, 'date' => $day->event_date->toDateString(), 'label' => $day->label,
            'games' => $day->matches->sortBy('match_index')->values()->map(fn ($match): array => [
                'id' => $match->id, 'map_code' => $match->map_code, 'map_label' => $match->map_label,
            ])->all(),
        ])->all();
    }

    /** @param list<array<string, mixed>> $days */
    private function scheduleSignature(array $days): string
    {
        return hash('sha256', json_encode($days, JSON_THROW_ON_ERROR));
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>, warnings: list<string>}
     */
    private function prepareRosterAdd(User $actor, array $action): array
    {
        $squad = Squad::query()->with('clan')->find($action['squad_id'] ?? '');
        $player = Player::query()->where('status', 'active')->find($action['player_id'] ?? '');
        if ($squad === null || $player === null || ! $this->organization->canManageClan($actor, $squad->clan)) {
            throw new InvalidArgumentException('Roster change: the squad or active player was not found, or you cannot manage that clan.');
        }
        if ($player->clan_id !== $squad->clan_id) {
            throw new InvalidArgumentException($player->current_ign.' is not registered with '.$squad->clan->name.'. Permanent clan changes are never made automatically; use a match substitution for guests.');
        }
        $current = $player->squadMemberships()->whereNull('left_at')->with('squad')->get();
        if ($current->contains('squad_id', $squad->id)) {
            throw new InvalidArgumentException($player->current_ign.' is already on '.$squad->name.'.');
        }
        $from = $current->first();

        return [
            'items' => [['label' => $player->current_ign.' → '.$squad->clan->name.' · '.$squad->name, 'before' => $from?->squad->name ?? 'no squad', 'after' => $squad->name]],
            'warnings' => [],
            'operation' => ['type' => 'add_roster_player', 'squad_id' => $squad->id, 'player_id' => $player->id, 'move_from_squad_id' => $from?->squad_id],
        ];
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>}
     */
    private function prepareRosterRemove(User $actor, array $action): array
    {
        $squad = Squad::query()->with('clan')->find($action['squad_id'] ?? '');
        $player = Player::query()->find($action['player_id'] ?? '');
        if ($squad === null || $player === null || ! $this->organization->canManageClan($actor, $squad->clan)) {
            throw new InvalidArgumentException('Roster change: the squad or player was not found, or you cannot manage that clan.');
        }
        if (! $squad->memberships()->where('player_id', $player->id)->whereNull('left_at')->exists()) {
            throw new InvalidArgumentException($player->current_ign.' is not on the current roster of '.$squad->name.'.');
        }

        return [
            'items' => [['label' => 'Remove '.$player->current_ign.' from '.$squad->name, 'before' => 'on roster', 'after' => 'left roster', 'note' => 'Past results keep their name. The profile and clan are unchanged.']],
            'operation' => ['type' => 'remove_roster_player', 'squad_id' => $squad->id, 'player_id' => $player->id],
        ];
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>, warnings: list<string>}
     */
    private function prepareMerge(User $actor, array $action): array
    {
        if (! $this->organization->canManageAll($actor)) {
            throw new InvalidArgumentException('Merging player profiles needs full organizer access.');
        }
        $source = Player::query()->find($action['source_id'] ?? '');
        $target = Player::query()->find($action['target_id'] ?? '');
        if ($source === null || $target === null || $source->id === $target->id) {
            throw new InvalidArgumentException('A merge needs two different existing profiles: the duplicate to remove and the profile to keep.');
        }
        $results = MatchPlayerResult::query()->where('player_id', $source->id)->count();

        return [
            'items' => [['label' => 'Merge '.$source->current_ign.' into '.$target->current_ign, 'before' => $results.' results on the duplicate', 'after' => 'all history on '.$target->current_ign,
                'note' => 'The duplicate profile is deleted and its names are kept as aliases. This cannot be undone.']],
            'warnings' => [],
            'operation' => ['type' => 'merge_players', 'source_id' => $source->id, 'target_id' => $target->id, 'expected_source_ign' => $source->current_ign, 'expected_target_ign' => $target->current_ign],
        ];
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>, warnings: list<string>}
     */
    private function prepareScoring(User $actor, CompetitionEvent $event, array $action): array
    {
        abort_unless($this->permissions->canManage($actor, $event), 403);
        $match = CompetitionMatch::query()->whereHas('day', fn ($q) => $q->where('event_id', $event->id))->find($action['match_id'] ?? '');
        $version = ScoringRuleVersion::query()->with('preset')->find($action['scoring_rule_version_id'] ?? '');
        if ($match === null || $version === null) {
            throw new InvalidArgumentException('Changing scoring needs a game in this competition and an existing scoring version from saved_data.scoring_presets.');
        }
        $saved = $match->resultRecords()->exists();

        return [
            'items' => [['label' => 'Scoring for Game '.$match->match_index, 'before' => ($match->rules_snapshot['preset_name'] ?? 'current rules').' v'.($match->rules_snapshot['version_number'] ?? '?'), 'after' => $version->preset->name.' v'.$version->version_number]],
            'warnings' => $saved ? ['Game '.$match->match_index.' has saved results; their points are recalculated under the new rules. Kills and placements are unchanged.'] : [],
            'operation' => ['type' => 'set_scoring', 'match_id' => $match->id, 'version_id' => $version->id, 'expected_version_id' => $match->scoring_rule_version_id],
        ];
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>, warnings: list<string>}
     */
    private function prepareLateEntry(User $actor, CompetitionEvent $event, array $action): array
    {
        abort_unless($this->permissions->canManage($actor, $event), 403);
        $match = CompetitionMatch::query()->whereHas('day', fn ($q) => $q->where('event_id', $event->id))->find($action['match_id'] ?? '');
        $slot = filter_var($action['slot_number'] ?? null, FILTER_VALIDATE_INT);
        $squad = isset($action['squad_id']) ? Squad::query()->with('clan')->find($action['squad_id']) : null;
        $clan = $squad?->clan ?? (isset($action['clan_id']) ? Clan::query()->find($action['clan_id']) : null);
        if ($match === null || ! $slot || $slot < 1 || $slot > 25 || $clan === null) {
            throw new InvalidArgumentException('A late entry needs a game in this competition, a squad or clan, and a slot number from 1 to 25.');
        }
        $holder = $event->squadEntries()->where('slot_number', $slot)->with('squad.clan')->first();
        if ($holder !== null && $holder->squad_id !== $squad?->id) {
            throw new InvalidArgumentException('Slot '.$slot.' belongs to '.$holder->squad->clan->name.'. Choose a free slot or move that squad first.');
        }

        return [
            'items' => [['label' => 'Late entry: '.$clan->name.($squad === null ? ' (new squad)' : ' · '.$squad->name), 'before' => 'not in Game '.$match->match_index, 'after' => 'slot '.$slot]],
            'warnings' => [],
            'operation' => ['type' => 'late_entry', 'match_id' => $match->id, 'squad_id' => $squad?->id, 'clan_id' => $squad === null ? $clan->id : null, 'slot_number' => $slot],
        ];
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array{items: list<array<string, mixed>>, operation: array<string, mixed>}
     */
    private function prepareSquad(User $actor, array $action): array
    {
        $clan = Clan::query()->find($action['clan_id'] ?? '');
        if ($clan === null || ! $this->organization->canManageClan($actor, $clan)) {
            throw new InvalidArgumentException('Squad creation: the clan was not found or you cannot manage it.');
        }
        $number = ((int) $clan->squads()->max('squad_number')) + 1;

        return [
            'items' => [['label' => 'New squad for '.$clan->name, 'before' => '—', 'after' => 'Squad '.$number]],
            'operation' => ['type' => 'create_squad', 'clan_id' => $clan->id, 'tag' => is_string($action['tag'] ?? null) ? mb_substr(trim($action['tag']), 0, 16) : null],
        ];
    }

    public function decide(User $actor, AssistantThread $thread, AssistantProposal $proposal, string $decision): void
    {
        DB::transaction(function () use ($actor, $thread, $proposal, $decision): void {
            $thread = AssistantThread::query()->lockForUpdate()->findOrFail($thread->id);
            abort_unless((string) $thread->user_id === (string) $actor->id, 404);
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($thread->event_id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $proposal = AssistantProposal::query()->where('thread_id', $thread->id)->lockForUpdate()->findOrFail($proposal->id);
            $status = $decision === 'accept' ? 'accepted' : 'rejected';
            if ($proposal->status === $status) {
                return;
            }
            abort_unless($proposal->status === 'pending', 409, 'This proposal is no longer pending. Ask the assistant for a fresh one.');
            if ($decision === 'accept') {
                $inverse = [];
                foreach ($proposal->payload['operations'] as $operation) {
                    $inverse[] = $this->apply($actor, $event, $operation);
                }
                $proposal->payload = [...$proposal->payload, 'inverse' => in_array(null, $inverse, true) ? null : array_reverse($inverse)];
                AuditLog::query()->create([
                    'actor_user_id' => $actor->id, 'action' => 'assistant.admin_action.accepted', 'entity_type' => 'competition_event', 'entity_id' => $event->id,
                    'before_data' => ['proposal_id' => $proposal->id, 'items' => array_column($proposal->preview['items'], 'before', 'label')],
                    'after_data' => ['proposal_id' => $proposal->id, 'operations' => $proposal->payload['operations']],
                    'reason' => $proposal->reason, 'occurred_at' => now(),
                ]);
            }
            $proposal->forceFill(['status' => $status, 'decided_at' => now()])->save();
            $thread->touch();
        });
    }

    /** @param array<string, mixed> $operation */
    private function apply(User $actor, CompetitionEvent $event, array $operation): ?array
    {
        return match ($operation['type']) {
            'set_slots' => $this->applySlots($actor, $event, $operation),
            'update_clan' => $this->applyClan($actor, $operation),
            'update_player' => $this->applyPlayer($actor, $operation),
            'record_warning' => $this->applyWarning($actor, $event, $operation),
            'revoke_warning' => $this->applyRevoke($actor, $operation),
            'set_schedule' => $this->applySchedule($actor, $event, $operation),
            'add_roster_player' => $this->applyRosterAdd($actor, $operation),
            'remove_roster_player' => $this->applyRosterRemove($actor, $operation),
            'merge_players' => $this->applyMerge($actor, $operation),
            'set_scoring' => $this->applyScoring($actor, $operation),
            'late_entry' => $this->applyLateEntry($actor, $operation),
            'create_squad' => $this->applySquad($actor, $operation),
            'restore_warning' => $this->applyRestore($operation),
            default => abort(422, 'Unknown administrative action.'),
        };
    }

    /** @param array<string, mixed> $operation */
    private function applySlots(User $actor, CompetitionEvent $event, array $operation): ?array
    {
        $this->slots->save($actor, $event, $operation['slots'], $operation['expected_version']);

        return ['type' => 'set_slots', 'expected_version' => $this->slots->show($actor, $event->fresh())['version'], 'slots' => $operation['before_slots'], 'before_slots' => $operation['before_slots']];
    }

    /** Reverse an accepted action when nothing it touched has changed since. */
    public function undo(User $actor, AssistantThread $thread, AssistantProposal $proposal): void
    {
        DB::transaction(function () use ($actor, $thread, $proposal): void {
            $thread = AssistantThread::query()->lockForUpdate()->findOrFail($thread->id);
            abort_unless((string) $thread->user_id === (string) $actor->id, 404);
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($thread->event_id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $proposal = AssistantProposal::query()->where('thread_id', $thread->id)->lockForUpdate()->findOrFail($proposal->id);
            abort_unless($proposal->status === 'accepted', 409, 'Only an accepted change can be undone.');
            abort_if(empty($proposal->payload['inverse']), 422, 'This change cannot be undone automatically (for example merges and late entries). Ask the assistant for the opposite change instead.');
            foreach ($proposal->payload['inverse'] as $operation) {
                $this->apply($actor, $event, $operation);
            }
            AuditLog::query()->create([
                'actor_user_id' => $actor->id, 'action' => 'assistant.admin_action.undone', 'entity_type' => 'competition_event', 'entity_id' => $event->id,
                'before_data' => ['proposal_id' => $proposal->id], 'after_data' => ['operations' => $proposal->payload['inverse']],
                'reason' => 'Organizer undid an accepted assistant change.', 'occurred_at' => now(),
            ]);
            $proposal->forceFill(['status' => 'undone', 'decided_at' => now()])->save();
        });
    }

    /** @param array<string, mixed> $operation */
    private function applyClan(User $actor, array $operation): ?array
    {
        $clan = Clan::query()->lockForUpdate()->findOrFail($operation['clan_id']);
        abort_unless($this->organization->canManageClan($actor, $clan), 403);
        abort_unless($clan->name === $operation['expected_name'] && $clan->tagList() === $operation['expected_tags'], 409, 'This clan changed after the proposal. Ask for a fresh one.');
        if (isset($operation['name'])) {
            abort_if(Clan::query()->whereKeyNot($clan->id)->whereRaw('LOWER(name) = ?', [mb_strtolower($operation['name'])])->exists(), 409, 'Another clan now uses that name.');
            $clan->name = $operation['name'];
        }
        if (array_key_exists('tags', $operation)) {
            $this->tagRegistry->assertAvailable($operation['tags'], $clan->id);
            $this->tagRegistry->assign($clan, $operation['tags']);
        }
        $clan->save();

        return ['type' => 'update_clan', 'clan_id' => $clan->id, 'expected_name' => $clan->name, 'expected_tags' => $clan->tagList(),
            'name' => $operation['expected_name'], 'tags' => $operation['expected_tags']];
    }

    /** @param array<string, mixed> $operation */
    private function applyPlayer(User $actor, array $operation): ?array
    {
        abort_unless($this->organization->canManageAll($actor), 403);
        $player = Player::query()->with('clan')->lockForUpdate()->findOrFail($operation['player_id']);
        abort_unless($player->current_ign === $operation['expected_ign'], 409, 'This player changed after the proposal. Ask for a fresh one.');
        $tags = $player->clan?->tagList() ?? [];
        $aliases = $operation['aliases'];
        if (isset($operation['ign'])) {
            $aliases[] = $player->current_ign;
            $player->current_ign = $operation['ign'];
            $player->save();
        }
        foreach (array_unique($aliases) as $alias) {
            $key = PlayerNameSearch::key(ClanTag::strip($alias, $tags));
            if ($key !== '' && PlayerNameSearch::key($player->current_ign) !== $key) {
                PlayerAlias::query()->firstOrCreate(['player_id' => $player->id, 'alias_key' => $key], ['alias' => $alias, 'source' => 'assistant']);
            }
        }

        return isset($operation['ign']) && $operation['aliases'] === []
            ? ['type' => 'update_player', 'player_id' => $player->id, 'expected_ign' => $player->current_ign, 'ign' => $operation['expected_ign'], 'aliases' => []]
            : null;
    }

    /** @param array<string, mixed> $operation */
    private function applyWarning(User $actor, CompetitionEvent $event, array $operation): ?array
    {
        $player = Player::query()->lockForUpdate()->findOrFail($operation['player_id']);
        $warning = PlayerWarning::query()->create([
            'player_id' => $player->id, 'event_id' => $event->id, 'match_id' => $operation['match_id'],
            'severity' => $operation['severity'], 'reason' => $operation['reason'], 'issued_by' => $actor->id, 'issued_at' => now(),
        ]);

        return ['type' => 'revoke_warning', 'warning_id' => $warning->id, 'reason' => 'Undone by the organizer.'];
    }

    /** @param array<string, mixed> $operation */
    private function applyRevoke(User $actor, array $operation): ?array
    {
        $warning = PlayerWarning::query()->lockForUpdate()->findOrFail($operation['warning_id']);
        abort_unless($warning->revoked_at === null, 409, 'That record was already revoked.');
        $warning->update(['revoked_at' => now(), 'revoked_by' => $actor->id, 'revoked_reason' => $operation['reason']]);

        return ['type' => 'restore_warning', 'warning_id' => $warning->id];
    }

    /** @param array<string, mixed> $operation */
    private function applyRestore(array $operation): ?array
    {
        $warning = PlayerWarning::query()->lockForUpdate()->findOrFail($operation['warning_id']);
        abort_if($warning->revoked_at === null, 409, 'That record is already active.');
        $warning->update(['revoked_at' => null, 'revoked_by' => null, 'revoked_reason' => null]);

        return ['type' => 'revoke_warning', 'warning_id' => $warning->id, 'reason' => 'Undone by the organizer.'];
    }

    /** @param array<string, mixed> $operation */
    private function applySchedule(User $actor, CompetitionEvent $event, array $operation): ?array
    {
        abort_unless(hash_equals($operation['expected_signature'], $this->scheduleSignature($this->scheduleDays($event))), 409, 'The schedule changed after this proposal. Ask for a fresh one.');
        $days = array_map(fn (array $day): array => ['id' => $day['id'], 'date' => $day['date'], 'label' => $day['label'], 'games' => array_map(
            fn (array $game): array => ['id' => $game['id'], 'map_code' => $game['map_code'], 'map_label' => $game['map_label']], $day['games'])], $operation['days']);
        $this->schedule->handle($actor, $event, $days);

        return ['type' => 'set_schedule', 'expected_signature' => $this->scheduleSignature($this->scheduleDays($event)), 'days' => $operation['before_days'], 'before_days' => $operation['before_days']];
    }

    /** @param array<string, mixed> $operation */
    private function applyRosterAdd(User $actor, array $operation): ?array
    {
        $squad = Squad::query()->with('clan')->lockForUpdate()->findOrFail($operation['squad_id']);
        abort_unless($this->organization->canManageClan($actor, $squad->clan), 403);
        $player = Player::query()->where('status', 'active')->findOrFail($operation['player_id']);
        $this->assignSquad->handle($player, $squad, $operation['move_from_squad_id']);

        return $operation['move_from_squad_id'] === null
            ? ['type' => 'remove_roster_player', 'squad_id' => $squad->id, 'player_id' => $player->id]
            : ['type' => 'add_roster_player', 'squad_id' => $operation['move_from_squad_id'], 'player_id' => $player->id, 'move_from_squad_id' => $squad->id];
    }

    /** @param array<string, mixed> $operation */
    private function applyRosterRemove(User $actor, array $operation): ?array
    {
        $squad = Squad::query()->with('clan')->lockForUpdate()->findOrFail($operation['squad_id']);
        abort_unless($this->organization->canManageClan($actor, $squad->clan), 403);
        $membership = $squad->memberships()->where('player_id', $operation['player_id'])->whereNull('left_at')->first();
        abort_if($membership === null, 409, 'The roster changed after this proposal. Ask for a fresh one.');
        $membership->update(['left_at' => now()]);

        return ['type' => 'add_roster_player', 'squad_id' => $squad->id, 'player_id' => $operation['player_id'], 'move_from_squad_id' => null];
    }

    /** @param array<string, mixed> $operation */
    private function applyMerge(User $actor, array $operation): ?array
    {
        abort_unless($this->organization->canManageAll($actor), 403);
        $source = Player::query()->lockForUpdate()->findOrFail($operation['source_id']);
        $target = Player::query()->lockForUpdate()->findOrFail($operation['target_id']);
        abort_unless($source->current_ign === $operation['expected_source_ign'] && $target->current_ign === $operation['expected_target_ign'], 409, 'A profile changed after this proposal. Ask for a fresh one.');
        PlayerWarning::query()->where('player_id', $source->id)->update(['player_id' => $target->id]);
        $this->mergeProfiles->handle($source, $target);

        return null;
    }

    /** @param array<string, mixed> $operation */
    private function applyScoring(User $actor, array $operation): ?array
    {
        $match = CompetitionMatch::query()->findOrFail($operation['match_id']);
        abort_unless($match->scoring_rule_version_id === $operation['expected_version_id'], 409, 'This game’s scoring changed after the proposal. Ask for a fresh one.');
        $this->scoring->handle($actor, $match, $operation['version_id']);

        return ['type' => 'set_scoring', 'match_id' => $match->id, 'version_id' => $operation['expected_version_id'], 'expected_version_id' => $operation['version_id']];
    }

    /** @param array<string, mixed> $operation */
    private function applyLateEntry(User $actor, array $operation): ?array
    {
        $match = CompetitionMatch::query()->findOrFail($operation['match_id']);
        app(MatchLateEntryController::class)($this->asRequest($actor, array_filter(['squad_id' => $operation['squad_id'], 'clan_id' => $operation['clan_id'], 'slot_number' => $operation['slot_number']])), $match, $this->permissions);

        return null;
    }

    /** @param array<string, mixed> $operation */
    private function applySquad(User $actor, array $operation): ?array
    {
        $clan = Clan::query()->findOrFail($operation['clan_id']);
        app(OrganizationController::class)->createSquad($this->asRequest($actor, array_filter(['tag' => $operation['tag']])), $clan, $this->organization);

        return null;
    }

    /** Reuse an existing controller's validation and writes for the accepting organizer.
     * @param  array<string, mixed>  $input
     */
    private function asRequest(User $actor, array $input): Request
    {
        $request = Request::create('/', 'POST', $input);
        $request->setUserResolver(fn (): User => $actor);

        return $request;
    }
}
