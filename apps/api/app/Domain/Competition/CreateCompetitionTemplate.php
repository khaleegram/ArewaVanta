<?php

namespace App\Domain\Competition;

use App\Domain\Scoring\ScoringMode;
use App\Models\AuditLog;
use App\Models\CompetitionTemplate;
use App\Models\CompetitionTemplateDay;
use App\Models\CompetitionTemplateGame;
use App\Models\ScoringRuleVersion;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class CreateCompetitionTemplate
{
    /** @param array<string, mixed> $data */
    public function handle(User $actor, array $data): CompetitionTemplate
    {
        return DB::transaction(function () use ($actor, $data): CompetitionTemplate {
            $versionIds = [$data['default_rule_version_id']];
            foreach ($data['days'] as $day) {
                foreach ($day['games'] as $game) {
                    if (! empty($game['rule_version_override_id'])) {
                        $versionIds[] = $game['rule_version_override_id'];
                    }
                }
            }
            $versions = ScoringRuleVersion::query()->with(['preset', 'tiers'])->whereIn('id', array_unique($versionIds))->get();
            $maximumPosition = $data['maximum_position'] ?? 25;
            foreach ($versions as $version) {
                $rules = $version->toScoringRules();
                try {
                    if ($rules->mode === ScoringMode::KillsOnly) {
                        if ($maximumPosition > $rules->maximumPosition) {
                            throw new \InvalidArgumentException;
                        }
                    } else {
                        $rules->tierForPosition($maximumPosition);
                    }
                } catch (\InvalidArgumentException) {
                    throw ValidationException::withMessages(['maximum_position' => 'Every scoring rule in the template must cover its maximum position.']);
                }
            }

            $id = (string) Str::ulid();
            $template = new CompetitionTemplate([
                'name' => $data['name'],
                'slug' => (Str::slug($data['name']) ?: 'template').'-'.Str::lower(substr($id, -8)),
                'description' => $data['description'] ?? null,
                'timezone' => $data['timezone'] ?? 'Africa/Lagos',
                'squad_size' => $data['squad_size'] ?? 4,
                'maximum_position' => $maximumPosition,
                'default_rule_version_id' => $data['default_rule_version_id'],
                'is_system' => false,
                'owner_id' => $actor->id,
            ]);
            $template->id = $id;
            $template->save();
            foreach ($data['days'] as $dayIndex => $dayData) {
                $day = CompetitionTemplateDay::query()->create([
                    'competition_template_id' => $template->id,
                    'label' => $dayData['label'],
                    'sort_order' => $dayIndex + 1,
                ]);
                foreach ($dayData['games'] as $gameIndex => $game) {
                    CompetitionTemplateGame::query()->create([
                        'competition_template_day_id' => $day->id,
                        'game_number' => $gameIndex + 1,
                        'map_code' => $game['map_code'],
                        'map_label' => $game['map_label'],
                        'rule_version_override_id' => $game['rule_version_override_id'] ?? null,
                    ]);
                }
            }

            AuditLog::query()->create([
                'actor_user_id' => $actor->id,
                'action' => 'competition_template_created',
                'entity_type' => 'competition_template',
                'entity_id' => $template->id,
                'after_data' => ['name' => $template->name, 'day_count' => count($data['days'])],
                'occurred_at' => now(),
            ]);

            return $template->load(['days.games.ruleVersionOverride.preset', 'defaultRuleVersion.preset']);
        });
    }
}
