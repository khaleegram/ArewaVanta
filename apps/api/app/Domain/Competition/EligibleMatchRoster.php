<?php

namespace App\Domain\Competition;

use App\Models\CompetitionMatch;
use App\Models\SquadMembership;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

final class EligibleMatchRoster
{
    /** @return Collection<string, Collection<string, SquadMembership>> */
    public function forMatch(CompetitionMatch $match): Collection
    {
        $match->loadMissing(['day.event', 'squadEntries']);
        $date = $match->day->event_date->toDateString();
        $start = CarbonImmutable::parse($date, $match->day->event->timezone)->startOfDay()->utc();
        $end = CarbonImmutable::parse($date, $match->day->event->timezone)->endOfDay()->utc();

        return SquadMembership::query()
            ->with('player')
            ->whereIn('squad_id', $match->squadEntries->pluck('squad_id'))
            ->where(fn ($query) => $query
                ->where(fn ($historical) => $historical->where('joined_at', '<=', $end)
                    ->where(fn ($dates) => $dates->whereNull('left_at')->orWhere('left_at', '>=', $start)))
                ->orWhere(fn ($current) => $current->whereNull('left_at')->where('joined_at', '<=', now())))
            ->whereHas('player', fn ($query) => $query->where('status', 'active'))
            ->get()
            ->groupBy('squad_id')
            ->map(static fn (Collection $memberships): Collection => $memberships->keyBy('player_id'));
    }
}
