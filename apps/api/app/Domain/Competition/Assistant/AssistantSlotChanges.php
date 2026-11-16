<?php

namespace App\Domain\Competition\Assistant;

use App\Domain\Competition\ResultPermissions;
use App\Models\AuditLog;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\CompetitionSeries;
use App\Models\EventSquad;
use App\Models\MatchSquad;
use App\Models\Squad;
use App\Models\User;
use Illuminate\Support\Str;
use InvalidArgumentException;

final class AssistantSlotChanges
{
    public function __construct(private readonly AssistantContext $context, private readonly ResultPermissions $permissions) {}

    /** @param list<array<string, mixed>> $changes
     * @return array<string, mixed>
     */
    public function prepare(User $actor, CompetitionEvent $event, array $changes): array
    {
        if ($changes === []) {
            return [];
        }
        if (count($changes) > 25) {
            throw new InvalidArgumentException('Choose up to 25 slot changes.');
        }
        $event->load('series', 'days', 'squadEntries.squad.clan');
        $effective = $event->series_week_date?->toDateString() ?? $event->days->first()?->event_date->toDateString();
        $weeks = collect([$event]);
        if ($event->series_id !== null) {
            $weeks = $weeks->concat(CompetitionEvent::query()->where('series_id', $event->series_id)->whereKeyNot($event->id)
                ->whereDate('series_week_date', '>=', $effective)->whereDoesntHave('days.matches.resultRecords')->orderBy('id')->get());
        }
        foreach ($weeks as $week) {
            if (! $this->permissions->canManage($actor, $week)) {
                throw new InvalidArgumentException('Permanent slot changes require organizer access to each affected weekend.');
            }
        }
        $book = collect($event->series?->default_slot_map ?? $event->squadEntries->where('status', 'active')->map(fn ($e): array => ['slot' => $e->slot_number, 'squad_id' => $e->squad_id])->all())->keyBy('slot');
        $assigned = $book->pluck('squad_id')->filter()->all();
        $squads = Squad::query()->where('status', 'active')->with('clan')->orderBy('squad_number')->get();
        $occupied = EventSquad::query()->whereIn('event_id', $weeks->pluck('id'))->where('status', 'active')->pluck('squad_id')->all();
        $plan = [];
        $seen = [];
        foreach ($changes as $change) {
            $number = filter_var($change['slot'] ?? null, FILTER_VALIDATE_INT);
            $clan = Clan::query()->find($change['clan_id'] ?? '');
            if (! $number || $number < 1 || $number > $event->squad_capacity || $clan === null || isset($seen[$number])) {
                throw new InvalidArgumentException('A slot change needs one valid lobby number and an existing clan.');
            }
            $seen[$number] = true;
            $old = $event->squadEntries->where('status', 'active')->firstWhere('slot_number', $number);
            if ($old?->squad->clan_id === $clan->id && ($book->get($number)['squad_id'] ?? null) === $old->squad_id) {
                continue;
            }
            $candidate = $squads->first(fn ($s): bool => $s->clan_id === $clan->id && ! in_array($s->id, $assigned, true)
                && ! in_array($s->id, $occupied, true));
            $plannedNumber = collect($plan)->filter(fn ($p): bool => $p['entry']['clan_id'] === $clan->id)->max('squad_number') ?? 0;
            $squadNumber = $candidate?->squad_number ?? max((int) Squad::query()->where('clan_id', $clan->id)->max('squad_number'), $plannedNumber) + 1;
            $id = $candidate?->id ?? (string) Str::ulid();
            $entry = ['squad_id' => $id, 'name' => $candidate?->name ?? 'Slot '.$number.' · '.$squadNumber,
                'clan_id' => $clan->id, 'clan' => $clan->name, 'clan_tag' => $clan->tag, 'slot' => $number, 'source_team_number' => $number];
            $plan[] = ['slot' => $number, 'before' => $old?->squad->clan->name ?? 'Unassigned', 'before_squad_id' => $old?->squad_id,
                'after' => $clan->name, 'entry' => $entry, 'create_identity' => $candidate === null, 'squad_number' => $squadNumber];
            $assigned[] = $id;
            $book->put($number, ['slot' => $number, 'squad_id' => $id, 'reserved_clan_id' => null]);
        }
        if ($plan === []) {
            return [];
        }
        $ids = $weeks->pluck('id')->sort()->values()->all();

        return ['changes' => $plan, 'event_ids' => $ids, 'series_id' => $event->series_id, 'effective_from' => $effective,
            'book' => $book->sortKeys()->values()->all(), 'signature' => $this->signature($event->series_id, $ids),
            'weeks' => $weeks->map(fn ($w): array => ['id' => $w->id, 'date' => $w->series_week_date?->toDateString() ?? $effective])->values()->all()];
    }

    /** @return array<string, mixed> */
    public function project(array $context, array $plan): array
    {
        foreach ($context['matches'] as &$match) {
            foreach ($plan['changes'] ?? [] as $change) {
                $removed = collect($match['entries'])->where('slot', $change['slot'])->pluck('squad_id')->all();
                $match['entries'] = array_values(array_filter($match['entries'], fn ($e): bool => $e['slot'] !== $change['slot']));
                $match['entries'][] = $change['entry'];
                $match['results'] = array_values(array_filter($match['results'], fn ($r): bool => ! in_array($r['squad_id'], $removed, true)));
            }
        }
        unset($match);

        return $context;
    }

    /** Lock before verifying any result baseline. Called within the acceptance transaction. */
    public function lock(User $actor, CompetitionEvent $event, array $plan): void
    {
        if ($event->series_id !== null) {
            CompetitionSeries::query()->lockForUpdate()->findOrFail($event->series_id);
        }
        $ids = $plan['event_ids'] ?? [$event->id];
        foreach (CompetitionEvent::query()->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get() as $week) {
            abort_unless($this->permissions->canManage($actor, $week), 403);
        }
        CompetitionMatch::query()->whereHas('day', fn ($q) => $q->whereIn('event_id', $ids))->orderBy('id')->lockForUpdate()->get();
        if ($plan !== []) {
            abort_unless(hash_equals($plan['signature'], $this->signature($plan['series_id'], $ids)), 409, 'Slot assignments or affected results changed. Ask for a fresh review before accepting.');
        }
    }

    public function apply(User $actor, array $plan): void
    {
        if ($plan === []) {
            return;
        }
        foreach ($plan['changes'] as $change) {
            $entry = $change['entry'];
            if ($change['create_identity']) {
                Clan::query()->lockForUpdate()->findOrFail($entry['clan_id']);
                $identity = new Squad(['clan_id' => $entry['clan_id'], 'name' => $entry['name'], 'squad_number' => $change['squad_number'],
                    'slug' => 'slot-'.strtolower($entry['squad_id']), 'status' => 'active', 'captain_user_id' => $actor->id]);
                $identity->id = $entry['squad_id'];
                $identity->save();
            }
            foreach ($plan['event_ids'] as $eventId) {
                $old = EventSquad::query()->where('event_id', $eventId)->where('slot_number', $change['slot'])->first();
                if ($old !== null && $old->squad_id !== $entry['squad_id']) {
                    $old->update(['status' => 'inactive', 'slot_number' => null]);
                }
                EventSquad::query()->updateOrCreate(['event_id' => $eventId, 'squad_id' => $entry['squad_id']], ['status' => 'active', 'slot_number' => $change['slot'], 'added_by' => $actor->id]);
                foreach (CompetitionMatch::query()->whereHas('day', fn ($q) => $q->where('event_id', $eventId))->get() as $match) {
                    if ($old !== null && $old->squad_id !== $entry['squad_id']) {
                        $match->squadEntries()->where('squad_id', $old->squad_id)->update(['entry_status' => 'excluded', 'source_team_number' => null]);
                    }
                    MatchSquad::query()->updateOrCreate(['match_id' => $match->id, 'squad_id' => $entry['squad_id']], ['entry_status' => 'expected', 'source_team_number' => $change['slot']]);
                }
                CompetitionEvent::query()->findOrFail($eventId)->submissions()->where('squad_id', $old?->squad_id)->where('status', 'selected')->update(['status' => 'not_selected', 'decided_by' => $actor->id, 'decided_at' => now()]);
            }
        }
        if ($plan['series_id'] !== null) {
            CompetitionSeries::query()->findOrFail($plan['series_id'])->update(['default_slot_map' => $plan['book'], 'default_slots_effective_from' => $plan['effective_from']]);
        }
        AuditLog::query()->create(['actor_user_id' => $actor->id, 'action' => 'assistant.slot_allocation.accepted', 'entity_type' => 'competition_event', 'entity_id' => $plan['event_ids'][0],
            'before_data' => ['owners' => array_column($plan['changes'], 'before', 'slot')], 'after_data' => $plan,
            'reason' => 'Organizer accepted the CSV review and its explicit slot allocation changes.', 'occurred_at' => now()]);
    }

    private function signature(?string $seriesId, array $ids): string
    {
        $series = $seriesId === null ? null : CompetitionSeries::query()->findOrFail($seriesId);
        $matches = CompetitionMatch::query()->whereHas('day', fn ($q) => $q->whereIn('event_id', $ids))->orderBy('id')->get()->map(fn ($m): array => $this->context->forMatch($m))->all();
        $entries = EventSquad::query()->whereIn('event_id', $ids)->orderBy('id')->get(['id', 'event_id', 'squad_id', 'slot_number', 'status'])->toArray();
        $identities = Squad::query()->orderBy('id')->get(['id', 'clan_id', 'name', 'squad_number', 'status'])->toArray();

        return hash('sha256', json_encode([$series?->default_slot_map, $series?->default_slots_effective_from?->toDateString(), $entries, $identities, $matches], JSON_THROW_ON_ERROR));
    }
}
