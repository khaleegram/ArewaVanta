<?php

namespace App\Domain\Competition;

use App\Domain\Notifications\AdminActivity;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\EventSquadSubmission;
use App\Models\Squad;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class ManageEventSquadSubmissions
{
    public function __construct(
        private readonly OrganizationPermissions $organizationPermissions,
        private readonly ResultPermissions $resultPermissions,
        private readonly SyncCompetitionSquads $syncSquads,
        private readonly AdminActivity $adminActivity,
    ) {}

    public function submit(User $actor, Squad $squad, CompetitionEvent $event): EventSquadSubmission
    {
        return DB::transaction(function () use ($actor, $squad, $event): EventSquadSubmission {
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            $squad->loadMissing('clan');
            abort_unless($this->organizationPermissions->canManageClan($actor, $squad->clan), 403);
            $this->ensureOpen($event);
            if ($event->visibility !== 'public') {
                throw ValidationException::withMessages(['event_id' => 'This competition is not open for squad submissions.']);
            }

            $submission = EventSquadSubmission::query()
                ->where('event_id', $event->id)->where('squad_id', $squad->id)->lockForUpdate()->first();
            if ($submission?->status === 'selected' || $submission?->status === 'pending') {
                throw ValidationException::withMessages(['event_id' => 'This squad has already been submitted to the competition.']);
            }

            if ($submission === null) {
                $submission = EventSquadSubmission::query()->create([
                    'event_id' => $event->id,
                    'squad_id' => $squad->id,
                    'status' => 'pending',
                    'submitted_by' => $actor->id,
                    'submitted_at' => now(),
                ]);
            } else {
                $submission->fill([
                    'status' => 'pending',
                    'submitted_by' => $actor->id,
                    'decided_by' => null,
                    'submitted_at' => now(),
                    'decided_at' => null,
                ])->save();
            }

            $this->adminActivity->record($actor, $actor->name.' submitted '.$squad->clan->tag.' · '.$squad->name.' for '.$event->title.'.');

            return $submission->load(['event', 'squad.clan']);
        });
    }

    public function withdraw(User $actor, Squad $squad, EventSquadSubmission $submission): void
    {
        DB::transaction(function () use ($actor, $squad, $submission): void {
            $submission = EventSquadSubmission::query()->with('event')->lockForUpdate()->findOrFail($submission->id);
            $squad->loadMissing('clan');
            abort_unless($submission->squad_id === $squad->id, 404);
            abort_unless($this->organizationPermissions->canManageClan($actor, $squad->clan), 403);
            $this->ensureOpen($submission->event);
            if ($submission->status !== 'pending') {
                throw ValidationException::withMessages(['submission' => 'Only a pending squad submission can be withdrawn.']);
            }

            $submission->fill(['status' => 'withdrawn', 'decided_by' => null, 'decided_at' => now()])->save();
            $this->adminActivity->record($actor, $actor->name.' withdrew '.$squad->clan->tag.' · '.$squad->name.' from '.$submission->event->title.'.');
        });
    }

    public function decide(User $actor, CompetitionEvent $event, EventSquadSubmission $submission, string $decision, ?int $slotNumber = null): EventSquadSubmission
    {
        return DB::transaction(function () use ($actor, $event, $submission, $decision, $slotNumber): EventSquadSubmission {
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            $submission = EventSquadSubmission::query()->with('squad.clan')->lockForUpdate()->findOrFail($submission->id);
            abort_unless($submission->event_id === $event->id, 404);
            abort_unless($this->resultPermissions->canManage($actor, $event), 403);
            $this->ensureOpen($event);

            if ($decision === 'select') {
                if (! in_array($submission->status, ['pending', 'selected'], true)) {
                    throw ValidationException::withMessages(['decision' => 'Only pending submissions can be assigned a slot.']);
                }
                if ($slotNumber === null || $slotNumber < 1 || $slotNumber > $event->squad_capacity || $slotNumber > 25) {
                    throw ValidationException::withMessages(['slot_number' => 'Choose a game-day slot between 1 and this competition’s capacity.']);
                }
                if ($event->squadEntries()->where('status', 'active')->where('slot_number', $slotNumber)
                    ->where('squad_id', '!=', $submission->squad_id)->exists()) {
                    throw ValidationException::withMessages(['slot_number' => 'That game-day slot is already assigned to another squad.']);
                }
                $activeIds = $event->squadEntries()->where('status', 'active')->pluck('squad_id')->all();
                $previousSlot = $event->squadEntries()->where('status', 'active')
                    ->where('squad_id', $submission->squad_id)->value('slot_number');
                if (! in_array($submission->squad_id, $activeIds, true) && count($activeIds) >= $event->squad_capacity) {
                    throw ValidationException::withMessages(['decision' => 'All competition squad slots are filled.']);
                }
                $wasSelected = $submission->status === 'selected';
                if (! $wasSelected) {
                    $submission->fill(['status' => 'selected', 'decided_by' => $actor->id, 'decided_at' => now()])->save();
                }
                $this->syncSquads->forEvent(
                    $actor,
                    $event,
                    array_values(array_unique([...$activeIds, $submission->squad_id])),
                    [$submission->squad_id => $slotNumber],
                );
                $activity = $wasSelected ? 'changed the game-day slot for ' : 'assigned a competition slot to ';
                $this->adminActivity->record($actor, $actor->name.' '.$activity.$submission->squad->clan->tag.' · '.$submission->squad->name.' for '.$event->title.'.');
                if (! $wasSelected || $previousSlot === null || (int) $previousSlot !== $slotNumber) {
                    $this->adminActivity->notifyClanCaptains(
                        [$submission->squad->clan_id],
                        'Your squad '.$submission->squad->name.' has been assigned slot '.$slotNumber.' for '.$event->title.'.',
                        '/competitions/'.rawurlencode($event->slug),
                        'slot-'.$event->id.'-'.$submission->squad_id,
                    );
                }
            } elseif ($decision === 'not_selected') {
                if ($submission->status !== 'pending') {
                    throw ValidationException::withMessages(['decision' => 'Only pending submissions can be marked not selected.']);
                }
                $submission->fill(['status' => 'not_selected', 'decided_by' => $actor->id, 'decided_at' => now()])->save();
                $this->adminActivity->record($actor, $actor->name.' marked '.$submission->squad->clan->tag.' · '.$submission->squad->name.' not selected for '.$event->title.'.');
                $this->adminActivity->notifyClanCaptains(
                    [$submission->squad->clan_id],
                    'Your squad '.$submission->squad->name.' was not selected for '.$event->title.'.',
                    '/competitions/'.rawurlencode($event->slug),
                    'entry-'.$event->id.'-'.$submission->squad_id,
                );
            } elseif ($decision === 'pending') {
                if ($submission->status !== 'selected') {
                    throw ValidationException::withMessages(['decision' => 'Only an assigned squad can be returned to review.']);
                }
                $previousSlot = $event->squadEntries()->where('status', 'active')
                    ->where('squad_id', $submission->squad_id)->value('slot_number');
                $submission->fill(['status' => 'pending', 'decided_by' => null, 'decided_at' => null])->save();
                $activeIds = $event->squadEntries()->where('status', 'active')->where('squad_id', '!=', $submission->squad_id)->pluck('squad_id')->all();
                $this->syncSquads->forEvent($actor, $event, $activeIds);
                $this->adminActivity->record($actor, $actor->name.' returned '.$submission->squad->clan->tag.' · '.$submission->squad->name.' to review for '.$event->title.'.');
                $this->adminActivity->notifyClanCaptains(
                    [$submission->squad->clan_id],
                    $previousSlot === null
                        ? 'Your squad '.$submission->squad->name.' was returned to review for '.$event->title.'.'
                        : 'Slot '.$previousSlot.' for your squad '.$submission->squad->name.' was removed from '.$event->title.'.',
                    '/competitions/'.rawurlencode($event->slug),
                    'entry-'.$event->id.'-'.$submission->squad_id,
                );
            } else {
                throw ValidationException::withMessages(['decision' => 'Choose a valid squad entry action.']);
            }

            return $submission->refresh();
        });
    }

    private function ensureOpen(CompetitionEvent $event): void
    {
        if ($event->skipped_at !== null) {
            throw ValidationException::withMessages(['event_id' => 'This week is not playing. Choose another week for squad entries.']);
        }
        $firstDate = $event->days()->orderBy('sort_order')->value('event_date');
        if ($firstDate === null || CarbonImmutable::parse($firstDate, $event->timezone)->lessThan(CarbonImmutable::today($event->timezone))) {
            throw ValidationException::withMessages(['event_id' => 'Squad entries are closed because the competition date has passed.']);
        }
        if (CompetitionMatch::query()->whereHas('day', fn ($query) => $query->where('event_id', $event->id))
            ->whereNotNull('current_published_revision_id')->exists()) {
            throw ValidationException::withMessages(['event_id' => 'Squad entries are closed because match results have started.']);
        }
    }
}
