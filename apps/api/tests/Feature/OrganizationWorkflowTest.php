<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\RoleAssignment;
use App\Models\SquadMembership;
use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class OrganizationWorkflowTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_organizer_manages_clan_squads_players_and_rosters_with_permissions(): void
    {
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*']);
        $this->postJson('/api/v1/manage/players', ['current_ign' => 'Blocked'])->assertUnauthorized();
        $clan = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/clans', ['name' => 'Kano', 'tag' => 'KAN'])->assertCreated()->json('data');
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/clans/{$clan['id']}", ['name' => 'Kano Clan', 'tag' => 'KAN', 'bio' => 'Community'])->assertOk()->assertJsonPath('data.bio', 'Community');
        $alpha = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/clans/{$clan['id']}/squads", ['name' => 'Alpha'])->assertCreated()->json('data');
        $bravo = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/clans/{$clan['id']}/squads", ['name' => 'Bravo'])->assertCreated()->json('data');
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/squads/{$bravo['id']}", ['name' => 'Bravo Team', 'tag' => 'B'])->assertOk()->assertJsonPath('data.name', 'Bravo Team');
        $player = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/players', ['current_ign' => 'Ace', 'uid' => 'ab 123'])->assertCreated()->assertJsonPath('data.uid', 'AB123')->assertJsonPath('data.uid_public', false)->json('data');
        $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/players', ['current_ign' => 'Duplicate', 'uid' => 'a b123'])->assertUnprocessable()->assertJsonValidationErrors('uid');
        $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/players', ['current_ign' => ['invalid'], 'uid' => ['invalid']])->assertUnprocessable()->assertJsonValidationErrors(['current_ign', 'uid']);
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/players/{$player['id']}", ['current_ign' => 'Ace Two', 'uid' => 'ab123', 'uid_public' => false])->assertOk()->assertJsonPath('data.current_ign', 'Ace Two');
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/players/{$player['id']}", ['current_ign' => 'Ace Three'])->assertOk()->assertJsonPath('data.uid', 'AB123');
        $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/squads/{$alpha['id']}/roster", ['player_id' => $player['id']])->assertCreated();
        $this->actingAs($organizer, 'sanctum')->deleteJson("/api/v1/manage/squads/{$alpha['id']}/roster/{$player['id']}")->assertNoContent();
        $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/squads/{$bravo['id']}/roster", ['player_id' => $player['id']])->assertCreated();
        $this->getJson("/api/v1/players/{$player['id']}")->assertOk()->assertJsonPath('data.uid', null)->assertJsonPath('data.current_squads.0.id', $bravo['id']);
        $visitor = User::factory()->create();
        $this->actingAs($visitor, 'sanctum')->patchJson("/api/v1/manage/clans/{$clan['id']}", ['name' => 'No', 'tag' => 'NO'])->assertForbidden();
        $this->actingAs($visitor, 'sanctum')->getJson("/api/v1/manage/players/{$player['id']}")->assertForbidden();
        $this->actingAs($visitor, 'sanctum')->patchJson("/api/v1/manage/players/{$player['id']}", ['current_ign' => 'No'])->assertForbidden();
    }

    public function test_captain_registers_a_clan_squad_and_roster_without_approval(): void
    {
        $captain = User::factory()->create();
        $clan = $this->actingAs($captain, 'sanctum')
            ->postJson('/api/v1/manage/clans', ['name' => 'Arewa Falcons', 'tag' => 'af'])
            ->assertCreated()->assertJsonPath('data.tag', 'AF')->json('data');
        $this->assertTrue($captain->hasRole(Role::ClanCaptain, RoleScope::Clan, $clan['id']));
        $this->actingAs($captain, 'sanctum')->postJson('/api/v1/manage/clans', ['name' => 'arewa falcons', 'tag' => 'other'])
            ->assertUnprocessable()->assertJsonValidationErrors('name');

        $squad = $this->actingAs($captain, 'sanctum')
            ->postJson("/api/v1/manage/clans/{$clan['id']}/squads", ['name' => 'Falcons Alpha', 'tag' => 'A'])
            ->assertCreated()->json('data');
        $this->actingAs($captain, 'sanctum')->patchJson("/api/v1/manage/clans/{$clan['id']}", ['name' => 'Arewa Falcons', 'tag' => 'AF', 'bio' => 'Team'])
            ->assertOk()->assertJsonPath('data.bio', 'Team');
        $this->actingAs($captain, 'sanctum')->patchJson("/api/v1/manage/squads/{$squad['id']}", ['name' => 'Falcons Alpha', 'tag' => 'A'])->assertOk();
        $this->actingAs($captain, 'sanctum')->postJson('/api/v1/manage/players', ['current_ign' => 'Forbidden'])->assertForbidden();

        $player = $this->actingAs($captain, 'sanctum')
            ->postJson("/api/v1/manage/squads/{$squad['id']}/roster", [
                'current_ign' => 'Falcon One', 'uid' => 'ab 123', 'joined_at' => '2026-10-01T00:00:00Z',
            ])->assertCreated()->json('data');
        $this->assertDatabaseHas('players', ['id' => $player['player_id'], 'normalized_uid' => 'AB123', 'uid_public' => false]);
        $this->actingAs($captain, 'sanctum')
            ->postJson("/api/v1/manage/squads/{$squad['id']}/roster", ['current_ign' => 'Another', 'uid' => ' aB123 '])
            ->assertUnprocessable()->assertJsonValidationErrors('uid');
        $this->actingAs($captain, 'sanctum')
            ->getJson("/api/v1/manage/squads/{$squad['id']}/roster")
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.ign', 'Falcon One');
        $this->getJson('/api/v1/clans?search=falcons')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson("/api/v1/clans/{$clan['slug']}")->assertOk()->assertJsonPath('data.squads.0.id', $squad['id']);
        $this->getJson("/api/v1/squads/{$squad['slug']}")->assertOk()->assertJsonPath('data.roster.0.ign', 'Falcon One')
            ->assertJsonMissingPath('data.roster.0.uid');
        $this->getJson('/api/v1/players?search=falcon')->assertOk()->assertJsonPath('data.0.id', $player['player_id']);
        $this->getJson("/api/v1/players/{$player['player_id']}")->assertOk()
            ->assertJsonPath('data.current_squads.0.slug', $squad['slug'])
            ->assertJsonPath('data.current_squads.0.clan.slug', $clan['slug']);

        $other = User::factory()->create();
        $this->actingAs($other, 'sanctum')->getJson("/api/v1/manage/squads/{$squad['id']}/roster")->assertForbidden();
        $this->actingAs($other, 'sanctum')->postJson("/api/v1/manage/clans/{$clan['id']}/squads", ['name' => 'Intruder'])->assertForbidden();
        $this->actingAs($captain, 'sanctum')->deleteJson("/api/v1/manage/squads/{$squad['id']}/roster/{$player['player_id']}")->assertNoContent();
        $this->assertNotNull(SquadMembership::query()->findOrFail($player['membership_id'])->left_at);
        $this->getJson("/api/v1/players/{$player['player_id']}")->assertOk()->assertJsonCount(0, 'data.current_squads');
        $this->assertDatabaseHas('audit_logs', ['action' => 'roster_player_removed', 'entity_id' => $squad['id']]);
    }
}
