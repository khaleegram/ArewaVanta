<?php

namespace Database\Seeders;

use App\Models\CompetitionTemplate;
use App\Models\CompetitionTemplateDay;
use App\Models\CompetitionTemplateGame;
use App\Models\ScoringPreset;
use App\Models\ScoringRuleVersion;
use App\Models\ScoringTier;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ArewaVantaFoundationSeeder extends Seeder
{
    public function run(): void
    {
        DB::transaction(function (): void {
            $balancedVersion = $this->seedPreset(
                name: 'ArewaVanta Placement + Kills',
                slug: 'aga-balanced',
                description: 'Each kill earns 1 point. Placement earns additional points based on finishing position.',
                mode: 'additive',
                fallbackPlacementPoints: '0',
                tiers: [
                    [1, 1, '12', null],
                    [2, 2, '9', null],
                    [3, 3, '7', null],
                    [4, 4, '5', null],
                    [5, 5, '4', null],
                    [6, 7, '3', null],
                    [8, 10, '2', null],
                    [11, 15, '1', null],
                    [16, 25, '0', null],
                ],
            );

            $this->seedPreset(
                name: 'Kills Only',
                slug: 'kills-only',
                description: 'Awards points for eliminations only.',
                mode: 'kills_only',
                tiers: [],
                maximumPosition: 100,
            );

            $this->seedPreset(
                name: 'Placement Only',
                slug: 'placement-only',
                description: 'Awards points for finishing position only.',
                mode: 'placement_only',
                fallbackPlacementPoints: '0',
                tiers: [
                    [1, 1, '12', null],
                    [2, 2, '9', null],
                    [3, 3, '7', null],
                    [4, 4, '5', null],
                    [5, 5, '4', null],
                    [6, 7, '3', null],
                    [8, 10, '2', null],
                    [11, 15, '1', null],
                    [16, 25, '0', null],
                ],
            );

            $template = CompetitionTemplate::query()->firstOrCreate(
                ['slug' => 'aga-weekend-default'],
                [
                    'name' => 'ArewaVanta Weekend Default',
                    'description' => 'Two event days with three games each: Isolated, Isolated, then Blackout.',
                    'timezone' => 'Africa/Lagos',
                    'squad_size' => 4,
                    'maximum_position' => 25,
                    'is_system' => true,
                    'default_rule_version_id' => $balancedVersion->id,
                ],
            );

            if ($template->days()->exists()) {
                return;
            }

            foreach (['Saturday', 'Sunday'] as $dayIndex => $dayLabel) {
                $day = CompetitionTemplateDay::query()->create([
                    'competition_template_id' => $template->id,
                    'label' => $dayLabel,
                    'sort_order' => $dayIndex + 1,
                ]);

                foreach (['Isolated', 'Isolated', 'Blackout'] as $gameIndex => $mapLabel) {
                    CompetitionTemplateGame::query()->create([
                        'competition_template_day_id' => $day->id,
                        'game_number' => $gameIndex + 1,
                        'map_code' => Str::slug($mapLabel),
                        'map_label' => $mapLabel,
                    ]);
                }
            }
        });
    }

    /**
     * @param  list<array{0: int, 1: int, 2: string|null, 3: string|null}>  $tiers
     */
    private function seedPreset(
        string $name,
        string $slug,
        string $description,
        string $mode,
        array $tiers,
        ?string $fallbackPlacementPoints = null,
        ?string $fallbackMultiplier = null,
        int $maximumPosition = 25,
    ): ScoringRuleVersion {
        $preset = ScoringPreset::query()->firstOrCreate(
            ['slug' => $slug],
            [
                'name' => $name,
                'description' => $description,
                'is_builtin' => true,
            ],
        );

        $version = ScoringRuleVersion::query()->firstOrCreate(
            [
                'scoring_preset_id' => $preset->id,
                'version_number' => 1,
            ],
            [
                'mode' => $mode,
                'kill_point_value' => '1.00',
                'maximum_position' => $maximumPosition,
                'fallback_placement_points' => $fallbackPlacementPoints,
                'fallback_multiplier' => $fallbackMultiplier,
            ],
        );

        if ($version->tiers()->exists()) {
            return $version;
        }

        foreach ($tiers as [$from, $through, $placementPoints, $multiplier]) {
            ScoringTier::query()->create([
                'scoring_rule_version_id' => $version->id,
                'position_from' => $from,
                'position_to' => $through,
                'placement_points' => $placementPoints,
                'multiplier' => $multiplier,
            ]);
        }

        return $version;
    }
}
