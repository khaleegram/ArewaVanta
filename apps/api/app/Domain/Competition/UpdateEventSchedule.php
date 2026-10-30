<?php

namespace App\Domain\Competition;

use App\Domain\Scoring\ScoringMode;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\EventDay;
use App\Models\MatchSquad;
use App\Models\ScoringRuleVersion;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class UpdateEventSchedule
{
    public function __construct(private readonly ResultPermissions $permissions, private readonly ChangeMatchScoring $changeScoring) {}

    /** @param list<array<string, mixed>> $days */
    public function handle(User $actor, CompetitionEvent $event, array $days): CompetitionEvent
    {
        return DB::transaction(function () use ($actor, $event, $days): CompetitionEvent {
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $oldDays = $event->days()->with('matches')->lockForUpdate()->get();
            $oldMatches = CompetitionMatch::query()->whereHas('day', fn ($query) => $query->where('event_id', $event->id))
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $oldDaysById = $oldDays->keyBy('id');
            $usedDays = [];
            $usedMatches = [];
            foreach ($days as $dayIndex => $dayData) {
                $id = array_key_exists('id', $dayData) ? $dayData['id'] : $oldDays->get($dayIndex)?->id;
                if ($id !== null && (! $oldDaysById->has($id) || isset($usedDays[$id]))) {
                    throw ValidationException::withMessages(['days' => 'Each existing day must belong to this event and appear only once.']);
                }
                if ($id !== null) {
                    $usedDays[$id] = true;
                }
                $previousDay = $id === null ? null : $oldDaysById->get($id);
                foreach ($dayData['games'] as $gameIndex => $gameData) {
                    $gameId = array_key_exists('id', $gameData) ? $gameData['id'] : $previousDay?->matches->get($gameIndex)?->id;
                    if ($gameId !== null && (! $oldMatches->has($gameId) || isset($usedMatches[$gameId]))) {
                        throw ValidationException::withMessages(['days' => 'Each existing game must belong to this event and appear only once.']);
                    }
                    if ($gameId !== null) {
                        $usedMatches[$gameId] = true;
                    }
                    $days[$dayIndex]['games'][$gameIndex]['resolved_id'] = $gameId;
                }
                $days[$dayIndex]['resolved_id'] = $id;
            }

            CompetitionMatch::query()->whereIn('id', $oldMatches->keys())->delete();
            $event->days()->delete();
            $squadIds = $event->squadEntries()->where('status', 'active')->pluck('squad_id');
            foreach ($days as $dayIndex => $dayData) {
                $day = $dayData['resolved_id'] === null ? new EventDay(['event_id' => $event->id]) : EventDay::withTrashed()->findOrFail($dayData['resolved_id']);
                $day->fill(['event_date' => $dayData['date'], 'label' => $dayData['label'], 'sort_order' => $dayIndex + 1]);
                $day->deleted_at = null;
                $day->save();
                foreach ($dayData['games'] as $gameIndex => $gameData) {
                    $versionId = $gameData['scoring_rule_version_id'] ?? null;
                    if ($gameData['resolved_id'] === null) {
                        $version = ScoringRuleVersion::query()->with(['preset', 'tiers'])->findOrFail($versionId ?? $event->scoring_rule_version_id);
                        $rules = $version->toScoringRules();
                        try {
                            if ($rules->mode === ScoringMode::KillsOnly && $event->maximum_position > $rules->maximumPosition) {
                                throw new \InvalidArgumentException;
                            }
                            if ($rules->mode !== ScoringMode::KillsOnly) {
                                $rules->tierForPosition($event->maximum_position);
                            }
                        } catch (\InvalidArgumentException) {
                            throw ValidationException::withMessages(['days' => 'Each scoring configuration must cover the event’s positions.']);
                        }
                        $match = new CompetitionMatch([
                            'scoring_rule_version_id' => $version->id,
                            'rules_snapshot' => [
                                'version_id' => $version->id, 'preset_id' => $version->preset->id,
                                'preset_slug' => $version->preset->slug, 'preset_name' => $version->preset->name,
                                'version_number' => $version->version_number, 'rules' => $rules->toArray(),
                            ],
                        ]);
                    } else {
                        $match = CompetitionMatch::withTrashed()->findOrFail($gameData['resolved_id']);
                    }
                    $match->fill([
                        'event_day_id' => $day->id, 'match_index' => $gameIndex + 1,
                        'map_code' => $gameData['map_code'], 'map_label' => $gameData['map_label'],
                    ]);
                    $match->deleted_at = null;
                    $isNew = ! $match->exists;
                    $match->save();
                    if ($isNew) {
                        foreach ($squadIds as $squadId) {
                            MatchSquad::query()->create(['match_id' => $match->id, 'squad_id' => $squadId, 'entry_status' => 'expected']);
                        }
                    } elseif ($versionId !== null && $versionId !== $match->scoring_rule_version_id) {
                        $this->changeScoring->handle($actor, $match, $versionId);
                    }
                }
            }

            return $event->load(['season', 'scoringRuleVersion.preset', 'scoringRuleVersion.tiers', 'days.matches.squadEntries.squad.clan', 'squadEntries.squad.clan']);
        });
    }
}
