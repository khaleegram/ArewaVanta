<?php

namespace App\Domain\Competition;

use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\CompetitionSeries;
use App\Models\EventSquad;
use App\Models\MatchSquad;
use App\Models\Squad;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class ApplySeriesSlots
{
    public function handle(CompetitionSeries $series, CompetitionEvent $week, bool $replace = false): int
    {
        return DB::transaction(function () use ($series, $week, $replace): int {
            $series = CompetitionSeries::query()->lockForUpdate()->findOrFail($series->id);
            $week = CompetitionEvent::query()->lockForUpdate()->findOrFail($week->id);
            if ($week->series_id !== $series->id || $week->series_week_date === null
                || $series->default_slots_effective_from === null
                || $week->series_week_date->lessThan($series->default_slots_effective_from)) {
                return 0;
            }

            $matches = CompetitionMatch::query()->whereHas('day', fn ($query) => $query->where('event_id', $week->id))
                ->lockForUpdate()->get();
            if ($matches->contains(fn ($match) => $match->resultRecords()->exists())) {
                return 0;
            }

            $slots = collect($series->default_slot_map ?? [])->filter(fn ($slot) => filled($slot['squad_id'] ?? null));
            if ($slots->pluck('slot')->duplicates()->isNotEmpty() || $slots->pluck('squad_id')->duplicates()->isNotEmpty()) {
                throw ValidationException::withMessages(['slots' => 'Each permanent slot must belong to one clan.']);
            }
            $squads = Squad::query()->whereIn('id', $slots->pluck('squad_id'))->get()->keyBy('id');
            $entries = $week->squadEntries()->lockForUpdate()->get();
            $added = 0;
            if ($replace) {
                $week->squadEntries()->update(['status' => 'inactive', 'slot_number' => null]);
                $entries = $week->squadEntries()->lockForUpdate()->get();
                foreach ($matches as $match) {
                    $match->squadEntries()->whereNotIn('squad_id', $slots->pluck('squad_id'))->update(['entry_status' => 'excluded']);
                }
            }
            foreach ($slots as $slot) {
                $number = (int) $slot['slot'];
                if ($number < 1 || $number > $week->squad_capacity) {
                    throw ValidationException::withMessages(['slots' => 'A permanent slot is outside this lobby’s capacity.']);
                }
                if (! $squads->has($slot['squad_id'])) {
                    continue;
                }
                $existing = $entries->firstWhere('squad_id', $slot['squad_id']);
                $occupant = $entries->firstWhere('slot_number', $number);
                if (! $replace && (($existing !== null && ($existing->slot_number !== $number || $existing->status !== 'active'))
                    || ($occupant !== null && $occupant->squad_id !== $slot['squad_id']))) {
                    throw ValidationException::withMessages(['slots' => 'This week already has different slot assignments. Review them before applying permanent slots.']);
                }
                if ($existing === null) {
                    $entry = EventSquad::query()->create([
                        'event_id' => $week->id, 'squad_id' => $slot['squad_id'],
                        'status' => 'active', 'slot_number' => $number, 'added_by' => $series->created_by,
                    ]);
                    $entries->push($entry);
                    $added++;
                }
                if ($replace && $existing !== null) {
                    $existing->update(['status' => 'active', 'slot_number' => $number]);
                }
                foreach ($matches as $match) {
                    if ($replace) {
                        MatchSquad::query()->updateOrCreate(
                            ['match_id' => $match->id, 'squad_id' => $slot['squad_id']],
                            ['entry_status' => 'expected'],
                        );

                        continue;
                    }
                    MatchSquad::query()->firstOrCreate(
                        ['match_id' => $match->id, 'squad_id' => $slot['squad_id']],
                        ['entry_status' => 'expected'],
                    );
                }
            }

            return $added;
        });
    }
}
