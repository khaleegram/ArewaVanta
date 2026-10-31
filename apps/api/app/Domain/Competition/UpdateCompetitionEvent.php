<?php

namespace App\Domain\Competition;

use App\Domain\Scoring\ScoringMode;
use App\Domain\Scoring\ScoringRules;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\ScoringRuleVersion;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class UpdateCompetitionEvent
{
    public function __construct(private readonly ResultPermissions $permissions, private readonly ChangeMatchScoring $changeScoring) {}

    /** @param array<string, mixed> $data */
    public function handle(User $actor, CompetitionEvent $event, array $data): CompetitionEvent
    {
        return DB::transaction(function () use ($actor, $event, $data): CompetitionEvent {
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $matches = CompetitionMatch::query()->whereHas('day', fn ($query) => $query->where('event_id', $event->id))
                ->with('currentResult.squadResults')->orderBy('id')->lockForUpdate()->get();
            $newDefault = isset($data['scoring_rule_version_id'])
                ? ScoringRuleVersion::query()->with('tiers')->findOrFail($data['scoring_rule_version_id'])
                : null;
            if ($newDefault !== null) {
                $rules = $newDefault->toScoringRules();
                $maximum = (int) ($data['maximum_position'] ?? $event->maximum_position);
                try {
                    if ($rules->mode === ScoringMode::KillsOnly && $maximum > $rules->maximumPosition) {
                        throw new \InvalidArgumentException;
                    }
                    if ($rules->mode !== ScoringMode::KillsOnly) {
                        $rules->tierForPosition($maximum);
                    }
                } catch (\InvalidArgumentException) {
                    throw ValidationException::withMessages(['scoring_rule_version_id' => 'The scoring configuration must cover the event’s maximum position.']);
                }
            }
            if (isset($data['maximum_position'])) {
                $maximum = (int) $data['maximum_position'];
                if ($event->squadEntries()->where('status', 'active')->count() > $maximum
                    || $matches->contains(fn ($match) => $match->currentResult?->squadResults->contains(fn ($result) => $result->placement > $maximum))) {
                    throw ValidationException::withMessages(['maximum_position' => 'The maximum must cover the assigned squads and saved placements.']);
                }
                foreach ($matches as $match) {
                    $rules = $newDefault !== null && $match->scoring_rule_version_id === $event->scoring_rule_version_id
                        ? $newDefault->toScoringRules()
                        : ScoringRules::fromArray($match->rules_snapshot['rules']);
                    try {
                        if ($rules->mode === ScoringMode::KillsOnly && $maximum > $rules->maximumPosition) {
                            throw new \InvalidArgumentException;
                        }
                        if ($rules->mode !== ScoringMode::KillsOnly) {
                            $rules->tierForPosition($maximum);
                        }
                    } catch (\InvalidArgumentException) {
                        throw ValidationException::withMessages(['maximum_position' => 'Every game’s scoring must cover the new maximum position.']);
                    }
                }
            }
            if (isset($data['squad_capacity'])
                && $event->squadEntries()->where('status', 'active')->count() > (int) $data['squad_capacity']) {
                throw ValidationException::withMessages(['squad_capacity' => 'Capacity cannot be lower than the number of squads already assigned.']);
            }
            $oldVersion = $event->scoring_rule_version_id;
            $event->fill($data)->save();
            if (isset($data['scoring_rule_version_id']) && $oldVersion !== $data['scoring_rule_version_id']) {
                foreach ($matches->where('scoring_rule_version_id', $oldVersion) as $match) {
                    $this->changeScoring->handle($actor, $match, $data['scoring_rule_version_id']);
                }
            }

            return $event->load([
                'season', 'scoringRuleVersion.preset', 'scoringRuleVersion.tiers',
                'days.matches.squadEntries.squad.clan.squads:id,clan_id',
                'squadEntries.squad.clan.squads:id,clan_id',
            ]);
        });
    }
}
