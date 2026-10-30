<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\RoleAssignment;
use App\Models\ScoringPreset;
use App\Models\Squad;
use App\Models\User;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class CompetitionEventCreationTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_organizer_can_create_and_edit_competition_using_management_form_requests(): void
    {
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = $this->organizer();
        $clan = Clan::factory()->create();
        $squad = Squad::factory()->for($clan)->create();
        $version = ScoringPreset::query()->where('slug', 'aga-balanced')->firstOrFail()->versions()->firstOrFail();
        $event = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', [
            'title' => 'Weekend Scrim', 'competition_type' => 'scrim', 'description' => 'Weekend games',
            'dates' => ['2099-10-03', '2099-10-04'], 'scoring_rule_version_id' => $version->id, 'squad_ids' => [$squad->id],
        ])->assertCreated()->json('data');
        $day = $event['days'][0];
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/events/{$event['id']}", [
            'title' => 'Updated League', 'competition_type' => 'league', 'description' => null, 'scoring_rule_version_id' => $version->id,
        ])->assertOk()->assertJsonPath('data.title', 'Updated League');
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/events/{$event['id']}/schedule", [
            'days' => [[
                'id' => $day['id'], 'label' => 'Saturday', 'date' => '2099-10-03',
                'games' => [['id' => $day['matches'][0]['id'], 'map_code' => 'blackout', 'map_label' => 'Blackout']],
            ]],
        ])->assertOk()->assertJsonPath('data.days.0.matches.0.id', $day['matches'][0]['id'])
            ->assertJsonPath('data.days.0.matches.0.map_label', 'Blackout');
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/events/{$event['id']}/squads", ['squad_ids' => []])
            ->assertOk()->assertJsonCount(0, 'data.squads');
        $this->actingAs($organizer, 'sanctum')->getJson("/api/v1/manage/events/{$event['id']}")
            ->assertOk()->assertJsonPath('data.competition_type', 'league')->assertJsonCount(1, 'data.days');
    }

    public function test_public_competition_details_are_optional_editable_and_include_squad_count(): void
    {
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = $this->organizer();
        $clan = Clan::factory()->create();
        Squad::factory()->count(2)->for($clan)->create();
        $event = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', [
            'title' => 'Weekend Scrim', 'description' => 'A community weekend.', 'competition_type' => 'scrim',
        ])->assertCreated()->assertJsonPath('data.description', 'A community weekend.')
            ->assertJsonPath('data.competition_type', 'scrim')->json('data');
        $this->getJson('/api/v1/events')->assertOk()->assertJsonPath('data.0.competition_type', 'scrim')->assertJsonPath('data.0.squad_count', 2);
        $this->getJson("/api/v1/events/{$event['slug']}")->assertOk()->assertJsonPath('data.description', 'A community weekend.')->assertJsonPath('data.squad_count', 2);
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/events/{$event['id']}", ['description' => null, 'competition_type' => 'league'])
            ->assertOk()->assertJsonPath('data.description', null)->assertJsonPath('data.competition_type', 'league');
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/events/{$event['id']}", ['competition_type' => 'imaginary'])
            ->assertUnprocessable()->assertJsonValidationErrors('competition_type');
    }

    public function test_default_weekend_is_generated_and_immediately_public(): void
    {
        $this->travelTo(now()->setDate(2026, 10, 27)->setTime(10, 0));
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = $this->organizer();
        $clan = Clan::factory()->create(['status' => 'pending']);
        Squad::factory()->count(2)->for($clan)->create(['status' => 'pending']);

        $event = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', ['title' => 'Weekend One'])
            ->assertCreated()->assertJsonPath('data.scoring.preset_name', 'ArewaVanta Balanced')
            ->assertJsonPath('data.days.0.date', '2026-10-31')->assertJsonPath('data.days.1.date', '2026-11-01')
            ->assertJsonPath('data.days.0.matches.0.map_label', 'Isolated')
            ->assertJsonPath('data.days.0.matches.1.map_label', 'Isolated')
            ->assertJsonPath('data.days.0.matches.2.map_label', 'Blackout')
            ->assertJsonCount(2, 'data.days.0.matches.0.expected_squads')->json('data');
        $this->assertDatabaseCount('matches', 6);
        $this->getJson("/api/v1/events/{$event['slug']}")->assertOk();
    }

    public function test_incomplete_dates_and_unsupported_scoring_range_are_rejected(): void
    {
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = $this->organizer();
        $warzone = ScoringPreset::query()->where('slug', 'warzone-style-multiplier')->firstOrFail()->versions()->firstOrFail();
        $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', ['title' => 'Weekend', 'dates' => ['2026-10-31']])
            ->assertUnprocessable()->assertJsonValidationErrors('dates');
        $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', [
            'title' => 'Weekend', 'scoring_rule_version_id' => $warzone->id, 'maximum_position' => 26,
        ])->assertUnprocessable()->assertJsonValidationErrors('scoring_rule_version_id');
        $this->assertDatabaseCount('events', 0);
    }

    public function test_unprivileged_user_cannot_create_or_edit_an_event(): void
    {
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = $this->organizer();
        $event = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', ['title' => 'Weekend'])->assertCreated()->json('data');
        $visitor = User::factory()->create();
        $this->actingAs($visitor, 'sanctum')->postJson('/api/v1/manage/events', ['title' => 'Unauthorized'])->assertForbidden();
        $this->actingAs($visitor, 'sanctum')->deleteJson("/api/v1/manage/events/{$event['id']}")->assertForbidden();
    }

    public function test_custom_templates_can_be_reused_by_organizers_and_generate_their_games(): void
    {
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = $this->organizer();
        $other = $this->organizer();
        $balanced = ScoringPreset::query()->where('slug', 'aga-balanced')->firstOrFail()->versions()->firstOrFail();
        $warzone = ScoringPreset::query()->where('slug', 'warzone-style-multiplier')->firstOrFail()->versions()->firstOrFail();
        $template = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/competition-templates', [
            'name' => 'Three day event', 'default_rule_version_id' => $balanced->id,
            'days' => [
                ['label' => 'Day 1', 'games' => [['map_code' => 'isolated', 'map_label' => 'Isolated']]],
                ['label' => 'Day 2', 'games' => [
                    ['map_code' => 'blackout', 'map_label' => 'Blackout'],
                    ['map_code' => 'isolated', 'map_label' => 'Isolated', 'rule_version_override_id' => $warzone->id],
                ]],
                ['label' => 'Day 3', 'games' => [['map_code' => 'blackout', 'map_label' => 'Blackout']]],
            ],
        ])->assertCreated()->assertJsonPath('data.days.1.games.1.override_preset_name', 'Warzone-Style Multiplier')->json('data');
        $this->actingAs($other, 'sanctum')->postJson('/api/v1/manage/events', [
            'title' => 'Custom event', 'competition_template_id' => $template['id'], 'dates' => ['2026-10-30', '2026-10-31', '2026-11-01'],
        ])->assertCreated()->assertJsonCount(3, 'data.days')->assertJsonCount(2, 'data.days.1.matches')
            ->assertJsonPath('data.days.1.matches.1.scoring.rules.mode', 'multiplier');
        $this->assertDatabaseCount('matches', 4);
        $this->getJson('/api/v1/scoring-presets')->assertOk()->assertJsonPath('data.0.name', 'ArewaVanta Balanced');
    }

    private function organizer(): User
    {
        $user = User::factory()->create();
        RoleAssignment::factory()->for($user)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*']);

        return $user;
    }
}
