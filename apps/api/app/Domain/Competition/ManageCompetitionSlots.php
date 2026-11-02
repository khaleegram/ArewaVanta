<?php

namespace App\Domain\Competition;

use App\Models\AuditLog;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\CompetitionSeries;
use App\Models\EventSquad;
use App\Models\MatchSquad;
use App\Models\Squad;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class ManageCompetitionSlots
{
    public function __construct(private readonly ResultPermissions $permissions, private readonly ApplySeriesSlots $apply) {}

    /** @return list<array{slot: int, squad_id: ?string, reserved_clan_id: ?string}> */
    private function book(CompetitionEvent $event): array
    {
        $raw = $event->series?->default_slot_map;
        if ($raw === null) {
            $raw = $event->squadEntries()->where('status', 'active')->whereNotNull('slot_number')->get()
                ->map(fn ($entry): array => ['slot' => $entry->slot_number, 'squad_id' => $entry->squad_id])->all();
        }

        return collect($raw)->map(fn ($slot): array => [
            'slot' => (int) $slot['slot'], 'squad_id' => $slot['squad_id'] ?? null,
            'reserved_clan_id' => filled($slot['squad_id'] ?? null) ? null : ($slot['reserved_clan_id'] ?? $slot['clan_id'] ?? null),
        ])->sortBy('slot')->values()->all();
    }

    /** @param list<array<string, mixed>> $book */
    private function version(CompetitionEvent $event, array $book): string
    {
        return hash('sha256', json_encode([$event->series_id ?? $event->id, $book], JSON_THROW_ON_ERROR));
    }

    /** @return array<string, mixed> */
    public function show(User $actor, CompetitionEvent $event): array
    {
        abort_unless($this->permissions->canManage($actor, $event), 403);
        $event->load('series');
        $book = $this->book($event);
        $capacity = $event->series_id === null ? $event->squad_capacity : 25;
        $squads = Squad::query()->with(['clan', 'memberships' => fn ($query) => $query->whereNull('left_at')->with('player')])
            ->where(fn ($query) => $query->where('status', 'active')->orWhereIn('id', array_column($book, 'squad_id')))
            ->orderBy('clan_id')->orderBy('squad_number')->get();
        $choices = $squads->map(fn ($squad): array => [
            'id' => $squad->id, 'name' => $squad->name, 'number' => $squad->squad_number,
            'clan' => ['id' => $squad->clan_id, 'name' => $squad->clan->name, 'tag' => $squad->clan->tag],
            'players' => $squad->memberships->filter(fn ($member): bool => $member->player?->status === 'active' && $member->player->clan_id === $squad->clan_id)
                ->map(fn ($member): array => ['id' => $member->player_id, 'ign' => $member->player->current_ign])->values()->all(),
        ])->keyBy('id');
        $clans = Clan::query()->orderBy('name')->get(['id', 'name', 'tag'])->keyBy('id');
        $byNumber = collect($book)->keyBy('slot');
        $scored = $event->days()->whereHas('matches.resultRecords')->exists();

        return [
            'event' => ['id' => $event->id, 'title' => $event->title, 'capacity' => $capacity, 'permanent' => $event->series_id !== null,
                'effective_from' => $event->series?->default_slots_effective_from?->toDateString(), 'can_edit' => $event->series_id !== null || ! $scored],
            'version' => $this->version($event, $book),
            'slots' => collect(range(1, $capacity))->map(function (int $number) use ($byNumber, $choices, $clans): array {
                $slot = $byNumber->get($number);
                $squad = $choices->get($slot['squad_id'] ?? '');
                $reservation = $clans->get($slot['reserved_clan_id'] ?? '');

                return ['slot' => $number, 'squad_id' => $slot['squad_id'] ?? null, 'reserved_clan_id' => $slot['reserved_clan_id'] ?? null,
                    'squad' => $squad, 'reserved_clan' => $reservation === null ? null : ['id' => $reservation->id, 'name' => $reservation->name, 'tag' => $reservation->tag]];
            })->all(),
            'squads' => $choices->values()->all(), 'clans' => $clans->values()->toArray(),
        ];
    }

    /** @param list<array<string, mixed>> $slots @return array<string, mixed> */
    public function save(User $actor, CompetitionEvent $event, array $slots, string $expectedVersion): array
    {
        return DB::transaction(function () use ($actor, $event, $slots, $expectedVersion): array {
            $series = $event->series_id === null ? null : CompetitionSeries::query()->lockForUpdate()->findOrFail($event->series_id);
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            $event->setRelation('series', $series);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $before = $this->book($event);
            abort_unless(hash_equals($this->version($event, $before), $expectedVersion), 409, 'Another organizer changed these slots. Reload the latest list before saving.');
            $capacity = $series === null ? $event->squad_capacity : 25;
            if (count($slots) !== $capacity || collect($slots)->pluck('slot')->sort()->values()->all() !== range(1, $capacity)) {
                throw ValidationException::withMessages(['slots' => 'Include each lobby slot once.']);
            }
            $assigned = collect($slots)->pluck('squad_id')->filter();
            if ($assigned->duplicates()->isNotEmpty()) {
                throw ValidationException::withMessages(['slots' => 'A squad can have one permanent slot. Move or swap its current slot.']);
            }
            foreach ($slots as $slot) {
                if (filled($slot['squad_id'] ?? null) && filled($slot['reserved_clan_id'] ?? null)) {
                    throw ValidationException::withMessages(['slots' => 'Assign a squad or reserve a clan slot, one at a time.']);
                }
            }
            $book = collect($slots)->filter(fn ($slot): bool => filled($slot['squad_id'] ?? null) || filled($slot['reserved_clan_id'] ?? null))
                ->map(fn ($slot): array => ['slot' => (int) $slot['slot'], 'squad_id' => $slot['squad_id'] ?? null, 'reserved_clan_id' => $slot['reserved_clan_id'] ?? null])
                ->sortBy('slot')->values()->all();
            $updatedWeeks = [];
            if ($series !== null) {
                $today = CarbonImmutable::today($series->timezone);
                $effective = $series->default_slots_effective_from?->toDateString() ?? $today->addDays((CarbonImmutable::SATURDAY - $today->dayOfWeek + 7) % 7)->toDateString();
                $series->update(['default_slot_map' => $book, 'default_slots_effective_from' => $effective]);
                foreach ($series->events()->whereDate('series_week_date', '>=', $effective)->whereHas('days', fn ($query) => $query->whereDate('event_date', '>=', $today->toDateString()))->lockForUpdate()->get() as $week) {
                    if ($week->days()->whereHas('matches.resultRecords')->exists()) {
                        continue;
                    }
                    if (collect($book)->whereNotNull('squad_id')->max('slot') > $week->squad_capacity) {
                        $week->update(['squad_capacity' => min(25, (int) collect($book)->max('slot'))]);
                    }
                    $this->apply->handle($series, $week, replace: true);
                    $this->syncRequests($week, $assigned->values()->all(), $actor);
                    $updatedWeeks[] = $week->id;
                }
            } else {
                $matches = CompetitionMatch::query()->whereHas('day', fn ($query) => $query->where('event_id', $event->id))->lockForUpdate()->get();
                abort_if($matches->contains(fn ($match) => $match->resultRecords()->exists()), 409, 'This competition has saved games. Their assigned slots are preserved.');
                $event->squadEntries()->update(['status' => 'inactive', 'slot_number' => null]);
                foreach ($matches as $match) {
                    $match->squadEntries()->whereNotIn('squad_id', $assigned)->update(['entry_status' => 'excluded']);
                }
                foreach ($book as $slot) {
                    if ($slot['squad_id'] === null) {
                        throw ValidationException::withMessages(['slots' => 'Clan reservations are available for recurring scrims.']);
                    }
                    EventSquad::query()->updateOrCreate(['event_id' => $event->id, 'squad_id' => $slot['squad_id']], ['status' => 'active', 'slot_number' => $slot['slot'], 'added_by' => $actor->id]);
                    foreach ($matches as $match) {
                        MatchSquad::query()->updateOrCreate(['match_id' => $match->id, 'squad_id' => $slot['squad_id']], ['entry_status' => 'expected']);
                    }
                }
                $this->syncRequests($event, $assigned->values()->all(), $actor);
                $updatedWeeks[] = $event->id;
            }
            AuditLog::query()->create(['actor_user_id' => $actor->id, 'action' => 'competition_slots_updated', 'entity_type' => $series === null ? 'competition_event' : 'competition_series', 'entity_id' => $series?->id ?? $event->id,
                'before_data' => ['slots' => $before], 'after_data' => ['slots' => $book, 'updated_weeks' => $updatedWeeks], 'reason' => 'Organizer changed slot assignments.', 'occurred_at' => now()]);
            $fresh = $event->fresh();

            return $this->show($actor, $fresh) + ['updated_weeks' => $updatedWeeks];
        });
    }

    /** @param list<string> $assigned */
    private function syncRequests(CompetitionEvent $week, array $assigned, User $actor): void
    {
        $week->submissions()->whereIn('squad_id', $assigned)->whereIn('status', ['pending', 'not_selected'])
            ->update(['status' => 'selected', 'decided_by' => $actor->id, 'decided_at' => now()]);
        $week->submissions()->whereNotIn('squad_id', $assigned)->where('status', 'selected')
            ->update(['status' => 'not_selected', 'decided_by' => $actor->id, 'decided_at' => now()]);
    }
}
