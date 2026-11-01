<?php

namespace App\Domain\Competition;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\CompetitionEvent;
use App\Models\CompetitionSeries;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class ManageWeeklyScrims
{
    public function update(User $actor, CompetitionEvent $event, string $action, ?string $reason = null): CompetitionEvent
    {
        abort_unless(
            $actor->isPlatformAdmin()
                || $actor->hasRole(Role::Organizer, RoleScope::Global, '*')
                || $actor->hasRole(Role::Organizer, RoleScope::Event, $event->id),
            403,
        );

        return DB::transaction(function () use ($event, $action, $reason): CompetitionEvent {
            // All recurrence writers lock the series before any of its events.
            $series = $event->series_id === null ? null : CompetitionSeries::query()->lockForUpdate()->findOrFail($event->series_id);
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            if ($action === 'start') {
                $event = $this->ensureRecurring($event);
                if ($event->series_id !== null) {
                    $this->generate($event->series);
                }

                return $event->fresh(['series.events.days', 'season', 'scoringRuleVersion.preset', 'scoringRuleVersion.tiers',
                    'days.matches.squadEntries.squad.clan.squads:id,clan_id', 'squadEntries.squad.clan.squads:id,clan_id']);
            } else {
                if ($series === null) {
                    throw ValidationException::withMessages(['action' => 'Enable weekly recurrence first.']);
                }
                if ($series->ended_at !== null) {
                    throw ValidationException::withMessages(['action' => 'This series has ended. Its saved weeks remain available.']);
                }
                if ($action === 'skip') {
                    $this->skipWeek($event, 'week', $reason);
                } elseif ($action === 'restore') {
                    if ($series->paused_at !== null) {
                        throw ValidationException::withMessages(['action' => 'Resume the series before restoring this week.']);
                    }
                    $event->forceFill(['skipped_at' => null, 'skip_source' => null, 'skip_reason' => null])->save();
                } elseif ($action === 'pause' || $action === 'end') {
                    $series->forceFill([$action === 'pause' ? 'paused_at' : 'ended_at' => now()])->save();
                    $today = CarbonImmutable::today($series->timezone)->toDateString();
                    foreach ($series->events()->whereHas('days', fn ($query) => $query->where('event_date', '>=', $today))->lockForUpdate()->get() as $week) {
                        if ($week->skipped_at === null && ! $this->hasResults($week)) {
                            $this->skipWeek($week, $action, $reason);
                        }
                    }
                } elseif ($action === 'resume') {
                    $series->forceFill(['paused_at' => null])->save();
                    $series->events()->where('skip_source', 'pause')
                        ->where('series_week_date', '>=', CarbonImmutable::today($series->timezone)->toDateString())
                        ->update(['skipped_at' => null, 'skip_source' => null, 'skip_reason' => null]);
                }
            }
            if ($series !== null) {
                $this->generate($series);
            }
            return $event->fresh(['series.events.days', 'season', 'scoringRuleVersion.preset', 'scoringRuleVersion.tiers',
                'days.matches.squadEntries.squad.clan.squads:id,clan_id', 'squadEntries.squad.clan.squads:id,clan_id']);
        });
    }

    public function ensureRecurring(CompetitionEvent $event): CompetitionEvent
    {
        return DB::transaction(function () use ($event): CompetitionEvent {
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            if ($event->competition_type !== 'scrim') {
                throw ValidationException::withMessages(['competition_type' => 'Weekly recurrence is available for scrims.']);
            }
            if ($event->series_id === null) {
                $days = $event->days()->get();
                $first = $days->min('event_date');
                $last = $days->max('event_date');
                if ($first === null || $first->diffInDays($last) >= 7) {
                    throw ValidationException::withMessages(['days' => 'A weekly scrim needs its games within one seven-day week.']);
                }
                $series = CompetitionSeries::query()->create([
                    'timezone' => $event->timezone,
                    'next_week_date' => $first->copy()->addWeek()->toDateString(),
                    'created_by' => $event->created_by,
                ]);
                $event->series_id = $series->id;
                $event->series_week_date = $first->toDateString();
                $event->save();
            }

            return $event->fresh(['series.events.days', 'season', 'scoringRuleVersion.preset', 'scoringRuleVersion.tiers',
                'days.matches.squadEntries.squad.clan.squads:id,clan_id', 'squadEntries.squad.clan.squads:id,clan_id']);
        });
    }

    public function generate(CompetitionSeries $series): int
    {
        return DB::transaction(function () use ($series): int {
            $series = CompetitionSeries::query()->lockForUpdate()->findOrFail($series->id);
            if ($series->paused_at !== null || $series->ended_at !== null) {
                return 0;
            }
            $today = CarbonImmutable::today($series->timezone);
            if (! $today->isMonday()) {
                return 0;
            }
            $next = CarbonImmutable::parse($series->next_week_date->toDateString(), $series->timezone);
            if ($next->lessThan($today)) {
                $next = $next->addWeeks((int) ceil($next->diffInDays($today) / 7));
            }
            // Keep only one active occurrence ahead. The Monday scheduler creates the
            // coming weekend after the previous one has finished, rather than staging
            // several empty weeks for captains to choose between.
            while ($series->events()->withTrashed()->whereDate('series_week_date', $next->toDateString())->exists()) {
                $next = $next->addWeek();
            }
            if ($next->greaterThan($today->addDays(6))) {
                if ($next->toDateString() !== $series->next_week_date->toDateString()) {
                    $series->forceFill(['next_week_date' => $next->toDateString()])->save();
                }

                return 0;
            }

            $source = $series->events()->where('series_week_date', '<', $next->toDateString())
                ->whereHas('days')->reorder()->orderByDesc('series_week_date')->with('days.matches')->first();
            if ($source === null) {
                return 0;
            }
            $anchor = $source->days->min('event_date');
            $last = $source->days->max('event_date');
            if ($anchor->diffInDays($last) >= 7) {
                throw ValidationException::withMessages(['days' => 'Keep recurring scrim games within one seven-day week.']);
            }
            $week = $source->replicate(['slug', 'series_week_date', 'skipped_at', 'skip_source', 'skip_reason']);
            $week->unsetRelations();
            $week->id = (string) Str::ulid();
            $week->slug = Str::limit(Str::slug($source->title), 150, '').'-'.$next->toDateString().'-'.strtolower($week->id);
            $week->series_week_date = $next->toDateString();
            $week->save();
            foreach ($source->days as $sourceDay) {
                $day = $sourceDay->replicate()->unsetRelations();
                $day->event_id = $week->id;
                $day->event_date = $next->addDays((int) $anchor->diffInDays($sourceDay->event_date))->toDateString();
                $day->save();
                foreach ($sourceDay->matches as $sourceMatch) {
                    $match = $sourceMatch->replicate(['current_published_revision_id', 'result_status'])->unsetRelations();
                    $match->event_day_id = $day->id;
                    $match->save();
                }
            }
            $seriesEventIds = $series->events()->pluck('id');
            DB::table('role_assignments')->where('role', Role::Organizer->value)
                ->where('scope_type', RoleScope::Event->value)->whereIn('scope_id', $seriesEventIds)
                ->whereNotIn('user_id', DB::table('role_assignments')->select('user_id')
                    ->where('role', Role::Organizer->value)->where('scope_type', RoleScope::Global->value)->where('scope_id', '*'))
                ->get(['user_id', 'assigned_by'])->each(function (object $assignment) use ($week): void {
                    DB::table('role_assignments')->insertOrIgnore([
                        'id' => (string) Str::ulid(), 'user_id' => $assignment->user_id,
                        'role' => Role::Organizer->value, 'scope_type' => RoleScope::Event->value,
                        'scope_id' => $week->id, 'assigned_by' => $assignment->assigned_by,
                        'created_at' => now(), 'updated_at' => now(),
                    ]);
                });
            $next = $next->addWeek();
            $series->forceFill(['next_week_date' => $next->toDateString()])->save();

            return 1;
        });
    }

    private function skipWeek(CompetitionEvent $event, string $source, ?string $reason): void
    {
        if ($this->hasResults($event)) {
            throw ValidationException::withMessages(['action' => 'This week has saved results. Keep those results and pause or end future weeks instead.']);
        }
        $event->forceFill(['skipped_at' => now(), 'skip_source' => $source, 'skip_reason' => $reason])->save();
    }

    private function hasResults(CompetitionEvent $event): bool
    {
        return $event->days()->whereHas('matches', fn ($query) => $query->whereNotNull('current_published_revision_id'))->exists();
    }
}
