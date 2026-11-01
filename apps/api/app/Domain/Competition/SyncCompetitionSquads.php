<?php

namespace App\Domain\Competition;

use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\EventSquad;
use App\Models\MatchSquad;
use App\Models\Squad;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class SyncCompetitionSquads
{
    public function __construct(
        private readonly ResultPermissions $permissions,
        private readonly SaveMatchResults $saveResults,
        private readonly UpdateCompetitionEvent $updateEvent,
    ) {}

    /** @param list<string> $squadIds */
    public function forEvent(User $actor, CompetitionEvent $event, array $squadIds, array $slotAssignments = []): CompetitionEvent
    {
        return DB::transaction(function () use ($actor, $event, $squadIds, $slotAssignments): CompetitionEvent {
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            if (Squad::query()->whereIn('id', $squadIds)->count() !== count($squadIds)) {
                throw ValidationException::withMessages(['squad_ids' => 'Choose existing squads.']);
            }
            if (count($squadIds) > $event->squad_capacity) {
                throw ValidationException::withMessages(['squad_ids' => 'The competition has no more squad slots available.']);
            }
            if (count($squadIds) > 25) {
                throw ValidationException::withMessages(['squad_ids' => 'A four-player CODM Battle Royale lobby has a maximum of 25 squads.']);
            }
            foreach ($slotAssignments as $squadId => $slotNumber) {
                if (! in_array($squadId, $squadIds, true) || $slotNumber < 1 || $slotNumber > $event->squad_capacity || $slotNumber > 25) {
                    throw ValidationException::withMessages(['slot_number' => 'Choose an available slot within this competition capacity.']);
                }
            }
            $activeIds = $event->squadEntries()->where('status', 'active')->pluck('squad_id')->all();
            $newIds = array_values(array_diff($squadIds, $activeIds));
            if ($newIds !== [] && $event->submissions()->whereIn('squad_id', $newIds)->where('status', 'selected')->count() !== count($newIds)) {
                throw ValidationException::withMessages(['squad_ids' => 'Only squads selected from captain submissions can be assigned.']);
            }
            foreach ($slotAssignments as $squadId => $slotNumber) {
                $isTaken = $event->squadEntries()->where('status', 'active')->where('slot_number', $slotNumber)
                    ->where('squad_id', '!=', $squadId)->exists();
                if ($isTaken) {
                    throw ValidationException::withMessages(['slot_number' => 'That game-day slot is already assigned to another squad.']);
                }
            }
            $removedIds = array_values(array_diff($activeIds, $squadIds));
            $hasPublishedResults = CompetitionMatch::query()
                ->whereHas('day', fn ($query) => $query->where('event_id', $event->id))
                ->whereNotNull('current_published_revision_id')->exists();
            if ($newIds !== [] || $removedIds !== []) {
                if ($hasPublishedResults) {
                    throw ValidationException::withMessages(['squad_ids' => 'Competition slots cannot change after match results have been saved.']);
                }
            }
            if (count($squadIds) > $event->maximum_position) {
                $event = $this->updateEvent->handle($actor, $event, ['maximum_position' => count($squadIds)]);
            }
            $matches = CompetitionMatch::query()->whereHas('day', fn ($query) => $query->where('event_id', $event->id))
                ->orderBy('id')->lockForUpdate()->get();
            $event->squadEntries()->whereNotIn('squad_id', $squadIds)->update(['status' => 'inactive', 'slot_number' => null]);
            $existingSlots = $event->squadEntries()->where('status', 'active')->pluck('slot_number', 'squad_id')->all();
            $takenSlots = [];
            foreach ($squadIds as $squadId) {
                $slot = $slotAssignments[$squadId] ?? $existingSlots[$squadId] ?? null;
                if ($slot !== null) {
                    $takenSlots[(int) $slot] = true;
                }
            }
            foreach ($squadIds as $squadId) {
                $slotNumber = $slotAssignments[$squadId] ?? $existingSlots[$squadId] ?? null;
                if ($slotNumber === null) {
                    for ($candidate = 1; $candidate <= $event->squad_capacity; $candidate++) {
                        if (! isset($takenSlots[$candidate])) {
                            $slotNumber = $candidate;
                            $takenSlots[$candidate] = true;
                            break;
                        }
                    }
                }
                EventSquad::query()->updateOrCreate(
                    ['event_id' => $event->id, 'squad_id' => $squadId],
                    ['status' => 'active', 'slot_number' => $slotNumber, 'added_by' => $actor->id],
                );
            }
            foreach ($matches as $match) {
                $this->syncMatch($actor, $match, $squadIds);
            }
            if ($removedIds !== []) {
                $event->submissions()->whereIn('squad_id', $removedIds)->where('status', 'selected')->update([
                    'status' => 'pending', 'decided_by' => null, 'decided_at' => null, 'updated_at' => now(),
                ]);
            }

            return $event->load([
                'season', 'scoringRuleVersion.preset', 'scoringRuleVersion.tiers',
                'days.matches.squadEntries.squad.clan.squads:id,clan_id',
                'squadEntries.squad.clan.squads:id,clan_id',
            ]);
        });
    }

    /** @param list<string> $squadIds */
    public function forMatch(User $actor, CompetitionMatch $match, array $squadIds): CompetitionMatch
    {
        return DB::transaction(function () use ($actor, $match, $squadIds): CompetitionMatch {
            $match = CompetitionMatch::query()->with('day.event')->lockForUpdate()->findOrFail($match->id);
            $event = $match->day->event;
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $registered = $event->squadEntries()->where('status', 'active')->whereIn('squad_id', $squadIds)->count();
            if ($registered !== count($squadIds)) {
                throw ValidationException::withMessages(['squad_ids' => 'Match squads must be registered for this event.']);
            }
            $this->syncMatch($actor, $match, $squadIds);

            return $match->load('squadEntries.squad.clan.squads:id,clan_id');
        });
    }

    /** @param list<string> $squadIds */
    private function syncMatch(User $actor, CompetitionMatch $match, array $squadIds): void
    {
        $oldIds = $match->squadEntries()->where('entry_status', 'expected')->pluck('squad_id')->sort()->values()->all();
        $newIds = collect($squadIds)->sort()->values()->all();
        if ($oldIds === $newIds) {
            return;
        }
        $current = $match->currentResult()->with('squadResults.playerResults')->first();
        $match->squadEntries()->whereNotIn('squad_id', $squadIds)->update(['entry_status' => 'excluded']);
        foreach ($squadIds as $squadId) {
            MatchSquad::query()->updateOrCreate(['match_id' => $match->id, 'squad_id' => $squadId], ['entry_status' => 'expected']);
        }
        if ($current === null) {
            return;
        }
        $rows = $current->squadResults->where('participation_status', 'present')->whereIn('squad_id', $squadIds)
            ->map(static fn ($result): array => [
                'squad_id' => $result->squad_id, 'status' => 'present', 'placement' => $result->placement,
                'team_kills' => $result->team_kills_override,
                'players' => $result->playerResults->map(static fn ($player): array => ['player_id' => $player->player_id, 'kills' => $player->kills])->all(),
            ])->values()->all();
        if ($rows === []) {
            $match->forceFill(['current_published_revision_id' => null, 'result_status' => 'empty'])->save();
        } else {
            $this->saveResults->handle($actor, $match, $rows);
        }
    }
}
