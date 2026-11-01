<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ManageEventSquadSubmissions;
use App\Domain\Competition\OrganizationPermissions;
use App\Domain\Competition\ResultPermissions;
use App\Http\Controllers\Controller;
use App\Models\CompetitionEvent;
use App\Models\EventSquad;
use App\Models\EventSquadSubmission;
use App\Models\Squad;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class EventSquadSubmissionController extends Controller
{
    public function forSquad(Request $request, Squad $squad, OrganizationPermissions $permissions): JsonResponse
    {
        $squad->load('clan');
        abort_unless($permissions->canManageClan($request->user(), $squad->clan), 403);

        $submissions = EventSquadSubmission::query()->with(['event.days'])
            ->whereHas('event', fn ($query) => $query->where('visibility', 'public'))
            ->where('squad_id', $squad->id)->orderByDesc('submitted_at')->get();
        $known = $submissions->keyBy('event_id');
        $events = CompetitionEvent::query()->with('days')
            ->with(['squadEntries' => fn ($query) => $query->where('status', 'active')])
            ->withCount(['squadEntries as squad_count' => fn ($query) => $query->where('status', 'active')])
            ->where('visibility', 'public')->whereNull('skipped_at')->get()
            ->filter(function (CompetitionEvent $event): bool {
                $lastDate = $event->days->max(fn ($day): string => $day->event_date->toDateString());

                return $lastDate !== null && CarbonImmutable::parse($lastDate, $event->timezone)
                    ->greaterThanOrEqualTo(CarbonImmutable::today($event->timezone));
            });
        $weeklyEvents = $events->filter(fn (CompetitionEvent $event): bool => $event->series_id !== null)
            ->groupBy('series_id')
            ->map(fn ($weeks) => $weeks->sortBy(fn (CompetitionEvent $event): string =>
                $event->days->min(fn ($day): string => $day->event_date->toDateString()) ?? '9999-12-31'
            )->first());
        $events = $events->filter(fn (CompetitionEvent $event): bool => $event->series_id === null)
            ->concat($weeklyEvents)->sortBy(fn (CompetitionEvent $event): string =>
                $event->days->min(fn ($day): string => $day->event_date->toDateString()) ?? '9999-12-31'
            )
            ->map(function (CompetitionEvent $event) use ($known, $squad): array {
                $startDate = $event->days->min(fn ($day): string => $day->event_date->toDateString());
                $endDate = $event->days->max(fn ($day): string => $day->event_date->toDateString());

                return [
                    'id' => $event->id,
                    'title' => $event->title,
                    'slug' => $event->slug,
                    'series_id' => $event->series_id,
                    'competition_type' => $event->competition_type,
                    'start_date' => $startDate,
                    'end_date' => $endDate,
                    'squad_capacity' => $event->squad_capacity,
                    'squad_count' => $event->squad_count,
                    'status' => $known->get($event->id)?->status,
                    'submission_id' => $known->get($event->id)?->id,
                    'slot_number' => $known->get($event->id)?->status === 'selected'
                        ? $event->squadEntries->firstWhere('squad_id', $squad->id)?->slot_number
                        : null,
                    'can_submit' => ! $event->days()->whereHas('matches', fn ($query) => $query->whereNotNull('current_published_revision_id'))->exists(),
                ];
            })->values();

        return response()->json(['data' => [
            'squad_id' => $squad->id,
            'clan' => ['name' => $squad->clan->name, 'tag' => $squad->clan->tag],
            'opportunities' => $events,
            'submissions' => $submissions->map(fn (EventSquadSubmission $submission): array => [
                'id' => $submission->id,
                'status' => $submission->status,
                'submitted_at' => $submission->submitted_at?->toIso8601String(),
                'event' => [
                    'id' => $submission->event->id,
                    'title' => $submission->event->title,
                    'slug' => $submission->event->slug,
                    'start_date' => $submission->event->days->sortBy('sort_order')->first()?->event_date->toDateString(),
                    'squad_capacity' => $submission->event->squad_capacity,
                ],
            ])->values(),
        ]]);
    }

    public function storeForSquad(Request $request, Squad $squad, ManageEventSquadSubmissions $manager): JsonResponse
    {
        $data = $request->validate(['event_id' => ['required', 'ulid', Rule::exists('events', 'id')]]);
        $submission = $manager->submit($request->user(), $squad, CompetitionEvent::query()->findOrFail($data['event_id']));

        return response()->json(['data' => $this->submissionData($submission)], 201);
    }

    public function withdraw(Request $request, Squad $squad, EventSquadSubmission $submission, ManageEventSquadSubmissions $manager): JsonResponse
    {
        $manager->withdraw($request->user(), $squad, $submission);

        return response()->json(status: 204);
    }

    public function forEvent(Request $request, CompetitionEvent $event, ResultPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManage($request->user(), $event), 403);
        $event->load(['days' => fn ($query) => $query->orderBy('sort_order')]);
        $assignedSlots = $event->squadEntries()->where('status', 'active')->pluck('slot_number', 'squad_id');
        $submissions = EventSquadSubmission::query()->with([
            'squad.clan.squads:id,clan_id',
            'squad.memberships' => fn ($query) => $query->whereNull('left_at'),
            'squad.memberships.player',
        ])->where('event_id', $event->id)->whereIn('status', ['pending', 'selected', 'not_selected'])
            ->orderByRaw("CASE status WHEN 'pending' THEN 0 WHEN 'selected' THEN 1 ELSE 2 END")
            ->orderBy('created_at')->get();

        $groups = $submissions->groupBy(fn (EventSquadSubmission $submission): string => $submission->squad->clan->id)
            ->map(function ($entries) use ($assignedSlots): array {
                $clan = $entries->first()->squad->clan;

                return [
                    'id' => $clan->id,
                    'name' => $clan->name,
                    'tag' => $clan->tag,
                    'squads' => $entries->map(fn (EventSquadSubmission $submission): array => [
                        'submission_id' => $submission->id,
                        'id' => $submission->squad->id,
                        'name' => $submission->squad->name,
                        'squad_number' => $submission->squad->squad_number,
                        'clan_squad_count' => $submission->squad->clan->squads->count(),
                        'status' => $submission->status,
                        'slot_number' => $assignedSlots->get($submission->squad_id) === null ? null : (int) $assignedSlots->get($submission->squad_id),
                        'submitted_at' => $submission->submitted_at?->toIso8601String(),
                        'players' => $submission->squad->memberships->filter(fn ($membership): bool => $membership->player?->status === 'active')
                            ->map(fn ($membership): string => $membership->player->current_ign)->values(),
                    ])->values(),
                ];
            })->values();

        return response()->json(['data' => [
            'event' => [
                'id' => $event->id,
                'title' => $event->title,
                'squad_capacity' => $event->squad_capacity,
                'selected_count' => $event->squadEntries()->where('status', 'active')->count(),
                'pending_count' => $submissions->where('status', 'pending')->count(),
            ],
            'clans' => $groups,
        ]]);
    }

    public function decide(Request $request, CompetitionEvent $event, EventSquadSubmission $submission, ManageEventSquadSubmissions $manager): JsonResponse
    {
        $data = $request->validate([
            'decision' => ['required', Rule::in(['select', 'not_selected', 'pending'])],
            'slot_number' => ['required_if:decision,select', 'prohibited_unless:decision,select', 'nullable', 'integer', 'min:1', 'max:25'],
        ]);
        $updated = $manager->decide($request->user(), $event, $submission, $data['decision'], $data['slot_number'] ?? null);

        return response()->json(['data' => $this->submissionData($updated)]);
    }

    /** @return array<string, mixed> */
    private function submissionData(EventSquadSubmission $submission): array
    {
        $slotNumber = $submission->status === 'selected'
            ? EventSquad::query()->where('event_id', $submission->event_id)->where('squad_id', $submission->squad_id)->where('status', 'active')->value('slot_number')
            : null;

        return [
            'id' => $submission->id,
            'event_id' => $submission->event_id,
            'squad_id' => $submission->squad_id,
            'status' => $submission->status,
            'slot_number' => $slotNumber === null ? null : (int) $slotNumber,
            'submitted_at' => $submission->submitted_at?->toIso8601String(),
            'decided_at' => $submission->decided_at?->toIso8601String(),
        ];
    }
}
