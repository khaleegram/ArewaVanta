<?php

namespace Tests\Feature;

use App\Domain\Scoring\ScoringEngine;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\RoleAssignment;
use App\Models\ScoringPreset;
use App\Models\User;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class ScoringPresetWorkflowTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_seeded_featured_presets_score_every_default_placement_correctly(): void
    {
        $this->seed(ArewaVantaFoundationSeeder::class);
        $balanced = ScoringPreset::query()->where('slug', 'aga-balanced')->firstOrFail()->versions()->with('tiers')->firstOrFail()->toScoringRules();
        $warzone = ScoringPreset::query()->where('slug', 'warzone-style-multiplier')->firstOrFail()->versions()->with('tiers')->firstOrFail()->toScoringRules();
        $balancedPoints = [12, 9, 7, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        $multipliers = ['2.0', ...array_fill(0, 4, '1.8'), ...array_fill(0, 5, '1.6'), ...array_fill(0, 10, '1.4'), ...array_fill(0, 5, '1.2')];
        $engine = new ScoringEngine;
        foreach (range(1, 25) as $position) {
            $this->assertSame((string) $balancedPoints[$position - 1], $engine->score(0, $position, $balanced)->placementPoints);
            $this->assertSame($multipliers[$position - 1], $engine->score(10, $position, $warzone)->placementMultiplier);
            $this->assertSame('0', $engine->score(0, $position, $warzone)->totalPoints);
        }
        $this->assertSame('19', $engine->score(10, 2, $balanced)->totalPoints);
        $this->assertSame('18.0', $engine->score(10, 2, $warzone)->totalPoints);
    }

    public function test_custom_versions_and_preview_preserve_builtin_and_previous_rules(): void
    {
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = $this->organizer();
        $otherOrganizer = $this->organizer();
        $balanced = ScoringPreset::query()->where('slug', 'aga-balanced')->firstOrFail();

        $clone = $this->actingAs($organizer, 'sanctum')
            ->postJson("/api/v1/manage/scoring-presets/{$balanced->id}/clone", ['name' => 'Custom multiplier'])
            ->assertCreated()
            ->assertJsonPath('data.is_builtin', false)
            ->assertJsonPath('data.versions.0.mode', 'additive')
            ->json('data');

        $rules = [
            'mode' => 'multiplier',
            'kill_point_value' => '1.25',
            'maximum_position' => 2,
            'tiers' => [
                ['position_from' => 1, 'position_to' => 1, 'multiplier' => '2.00'],
                ['position_from' => 2, 'position_to' => 2, 'multiplier' => '1.80'],
            ],
        ];
        $this->actingAs($organizer, 'sanctum')
            ->postJson('/api/v1/manage/scoring-preview', ['rules' => $rules, 'team_kills' => 10, 'placement' => 2])
            ->assertOk()->assertJsonPath('data.total_points', '22.5');
        $this->actingAs($organizer, 'sanctum')
            ->postJson('/api/v1/manage/scoring-presets', ['name' => 'Quick custom', 'rules' => $rules])
            ->assertCreated()->assertJsonPath('data.versions.0.mode', 'multiplier');
        $this->actingAs($organizer, 'sanctum')
            ->putJson("/api/v1/manage/scoring-presets/{$clone['id']}", ['rules' => $rules])
            ->assertCreated()
            ->assertJsonPath('data.versions.0.mode', 'additive')
            ->assertJsonPath('data.versions.1.mode', 'multiplier');

        $this->actingAs($organizer, 'sanctum')
            ->putJson("/api/v1/manage/scoring-presets/{$balanced->id}", ['rules' => $rules])
            ->assertUnprocessable()->assertJsonValidationErrors('preset');
        $this->actingAs($otherOrganizer, 'sanctum')
            ->putJson("/api/v1/manage/scoring-presets/{$clone['id']}", ['rules' => $rules])
            ->assertCreated();

        $rules['tiers'][1]['position_from'] = 1;
        $this->actingAs($organizer, 'sanctum')
            ->putJson("/api/v1/manage/scoring-presets/{$clone['id']}", ['rules' => $rules])
            ->assertUnprocessable()->assertJsonValidationErrors('rules');
        $this->assertSame(3, ScoringPreset::query()->findOrFail($clone['id'])->versions()->count());
        $this->assertSame(1, $balanced->versions()->count());
    }

    private function organizer(): User
    {
        $user = User::factory()->create();
        RoleAssignment::factory()->for($user)->create([
            'role' => Role::Organizer->value,
            'scope_type' => RoleScope::Global->value,
            'scope_id' => '*',
        ]);

        return $user;
    }
}
