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
    public function forEvent(User $actor, CompetitionEvent $event, array $squadIds): CompetitionEvent
    {
        return DB::transaction(function () use ($actor, $event, $squadIds): CompetitionEvent {
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            if (Squad::query()->whereIn('id', $squadIds)->count() !== count($squadIds)) {
                throw ValidationException::withMessages(['squad_ids' => 'Choose existing squads.']);
            }
            if (count($squadIds) > $event->maximum_position) {
                $event = $this->updateEvent->handle($actor, $event, ['maximum_position' => count($squadIds)]);
            }
            $matches = CompetitionMatch::query()->whereHas('day', fn ($query) => $query->where('event_id', $event->id))
                ->orderBy('id')->lockForUpdate()->get();
            $event->squadEntries()->whereNotIn('squad_id', $squadIds)->update(['status' => 'inactive']);
            foreach ($squadIds as $squadId) {
                EventSquad::query()->updateOrCreate(
                    ['event_id' => $event->id, 'squad_id' => $squadId],
                    ['status' => 'active', 'added_by' => $actor->id],
                );
            }
            foreach ($matches as $match) {
                $this->syncMatch($actor, $match, $squadIds);
            }

            return $event->load(['season', 'scoringRuleVersion.preset', 'scoringRuleVersion.tiers', 'days.matches.squadEntries.squad.clan', 'squadEntries.squad.clan']);
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

            return $match->load('squadEntries.squad.clan');
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
                'players' => $result->playerResults->map(static fn ($player): array => ['player_id' => $player->player_id, 'kills' => $player->kills])->all(),
            ])->values()->all();
        if ($rows === []) {
            $match->forceFill(['current_published_revision_id' => null, 'result_status' => 'empty'])->save();
        } else {
            $this->saveResults->handle($actor, $match, $rows);
        }
    }
}
