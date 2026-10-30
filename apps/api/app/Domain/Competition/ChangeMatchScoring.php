<?php

namespace App\Domain\Competition;

use App\Domain\Scoring\ScoringEngine;
use App\Domain\Scoring\ScoringMode;
use App\Models\AuditLog;
use App\Models\CompetitionMatch;
use App\Models\ScoringRuleVersion;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class ChangeMatchScoring
{
    public function __construct(private readonly ResultPermissions $permissions, private readonly ScoringEngine $scoring) {}

    public function handle(User $actor, CompetitionMatch $match, string $ruleVersionId): CompetitionMatch
    {
        return DB::transaction(function () use ($actor, $match, $ruleVersionId): CompetitionMatch {
            $match = CompetitionMatch::query()->with('day.event')->lockForUpdate()->findOrFail($match->id);
            $event = $match->day->event;
            abort_unless($this->permissions->canManage($actor, $event), 403);

            $version = ScoringRuleVersion::query()->with(['preset', 'tiers'])->findOrFail($ruleVersionId);

            $rules = $version->toScoringRules();
            try {
                if ($rules->mode === ScoringMode::KillsOnly) {
                    if ($event->maximum_position > $rules->maximumPosition) {
                        throw new \InvalidArgumentException;
                    }
                } else {
                    $rules->tierForPosition($event->maximum_position);
                }
            } catch (\InvalidArgumentException) {
                throw ValidationException::withMessages([
                    'scoring_rule_version_id' => 'The selected rules must cover every position in this event.',
                ]);
            }

            $before = $match->rules_snapshot;
            $snapshot = [
                'version_id' => $version->id,
                'preset_id' => $version->preset->id,
                'preset_slug' => $version->preset->slug,
                'preset_name' => $version->preset->name,
                'version_number' => $version->version_number,
                'rules' => $rules->toArray(),
            ];
            $current = $match->currentResult()->with('squadResults')->first();
            if ($current !== null) {
                foreach ($current->squadResults as $result) {
                    $score = $result->participation_status === 'present'
                        ? $this->scoring->score($result->team_kills, $result->placement, $rules)
                        : null;
                    $result->forceFill([
                        'kill_points' => $score?->killPoints ?? '0', 'placement_points' => $score?->placementPoints,
                        'placement_multiplier' => $score?->placementMultiplier, 'total_points' => $score?->totalPoints ?? '0',
                    ])->save();
                }
                $current->forceFill(['rules_snapshot' => $snapshot, 'authored_by' => $actor->id, 'published_at' => now()])->save();
            }
            $match->forceFill([
                'scoring_rule_version_id' => $version->id,
                'rules_snapshot' => $snapshot,
            ])->save();

            AuditLog::query()->create([
                'actor_user_id' => $actor->id,
                'action' => 'match_scoring_changed',
                'entity_type' => 'match',
                'entity_id' => $match->id,
                'before_data' => $before,
                'after_data' => $snapshot,
                'occurred_at' => now(),
            ]);

            return $match;
        });
    }
}
