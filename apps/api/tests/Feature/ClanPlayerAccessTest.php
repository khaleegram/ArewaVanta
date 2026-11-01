<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\Player;
use App\Models\RoleAssignment;
use App\Models\Squad;
use App\Models\SquadMembership;
use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class ClanPlayerAccessTest extends TestCase
{
    use LazilyRefreshDatabase;

    private function captainFor(Clan $clan): User
    {
        $captain = User::factory()->create();
        RoleAssignment::factory()->for($captain)->create([
            'role' => Role::ClanCaptain->value, 'scope_type' => RoleScope::Clan->value, 'scope_id' => $clan->id,
        ]);

        return $captain;
    }

    public function test_name_search_ignores_clan_tags_accents_and_common_decorated_letters(): void
    {
        $clan = Clan::factory()->create();
        $nero = Player::factory()->create(['clan_id' => $clan->id, 'current_ign' => 'B¹ · ñērø']);
        $silky = Player::factory()->create(['clan_id' => $clan->id, 'current_ign' => '¹P | Sɪʟᴋʏ']);
        $mormoni = Player::factory()->create(['clan_id' => $clan->id, 'current_ign' => 'AKメ · 𝓜𝓸𝓻𝓶𝓸𝓷𝓲']);
        Player::factory()->create(['clan_id' => Clan::factory()->create()->id, 'current_ign' => 'Other · Nero']);
        $this->actingAs($this->captainFor($clan), 'sanctum');
        foreach (['nero' => $nero, 'NE RO' => $nero, 'ēr' => $nero, 'silky' => $silky, 's-i-l-k-y' => $silky, 'mormoni' => $mormoni] as $query => $player) {
            $this->getJson("/api/v1/manage/clans/{$clan->id}/players?search=".urlencode($query))
                ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $player->id);
        }
    }

    public function test_captain_picker_and_direct_roster_requests_are_limited_to_their_clan(): void
    {
        $clan = Clan::factory()->create();
        $other = Clan::factory()->create();
        $captain = $this->captainFor($clan);
        $squad = Squad::factory()->for($clan)->create();
        $own = Player::factory()->create(['clan_id' => $clan->id, 'current_ign' => 'Ace Own']);
        $foreign = Player::factory()->create(['clan_id' => $other->id, 'current_ign' => 'Ace Foreign']);
        $unowned = Player::factory()->create();
        $this->getJson("/api/v1/manage/clans/{$clan->id}/players")->assertUnauthorized();
        $this->actingAs($captain, 'sanctum')->getJson("/api/v1/manage/clans/{$clan->id}/players?search=Ace")
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $own->id)->assertJsonMissingPath('data.0.uid');
        $this->getJson("/api/v1/manage/clans/{$clan->id}/players?search=Foreign")->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/manage/clans/{$other->id}/players")->assertForbidden();
        $this->postJson("/api/v1/manage/clans/{$other->id}/players", ['current_ign' => 'Intruder'])->assertForbidden();
        foreach ([$foreign, $unowned] as $player) {
            $this->postJson("/api/v1/manage/squads/{$squad->id}/roster", ['player_id' => $player->id])
                ->assertUnprocessable()->assertJsonValidationErrors('player_id');
            $this->assertDatabaseMissing('squad_memberships', ['squad_id' => $squad->id, 'player_id' => $player->id]);
        }
        $this->postJson("/api/v1/manage/squads/{$squad->id}/roster", ['player_id' => $own->id])->assertCreated();
        $this->assertSame($other->id, $foreign->fresh()->clan_id);
    }

    public function test_removed_player_remains_in_clan_pool_and_can_rejoin_a_squad(): void
    {
        $clan = Clan::factory()->create();
        $first = Squad::factory()->for($clan)->create();
        $this->actingAs($this->captainFor($clan), 'sanctum');
        $playerId = $this->postJson("/api/v1/manage/clans/{$clan->id}/players", ['current_ign' => 'Reserve', 'uid' => 'ab 123'])
            ->assertCreated()->assertJsonCount(0, 'data.squads')->json('data.id');
        $this->assertDatabaseHas('players', ['id' => $playerId, 'clan_id' => $clan->id, 'normalized_uid' => 'AB123', 'uid_public' => false]);
        $this->postJson("/api/v1/manage/squads/{$first->id}/roster", ['player_id' => $playerId])->assertCreated();
        $this->getJson("/api/v1/manage/clans/{$clan->id}/players")->assertOk()->assertJsonPath('data.0.squads.0.id', $first->id);
        $this->deleteJson("/api/v1/manage/squads/{$first->id}/roster/{$playerId}")->assertNoContent();
        $this->getJson("/api/v1/manage/clans/{$clan->id}/players")->assertOk()->assertJsonCount(1, 'data')->assertJsonCount(0, 'data.0.squads');
        $this->postJson("/api/v1/manage/squads/{$first->id}/roster", ['player_id' => $playerId])->assertCreated();
        $this->assertDatabaseHas('squad_memberships', ['squad_id' => $first->id, 'player_id' => $playerId]);
        $this->assertDatabaseHas('players', ['id' => $playerId, 'clan_id' => $clan->id]);
    }

    public function test_new_roster_players_belong_to_the_target_clan_and_uids_cannot_duplicate_foreign_players(): void
    {
        $clan = Clan::factory()->create();
        $squad = Squad::factory()->for($clan)->create();
        $this->actingAs($this->captainFor($clan), 'sanctum');
        $id = $this->postJson("/api/v1/manage/squads/{$squad->id}/roster", ['current_ign' => 'New teammate'])
            ->assertCreated()->json('data.player_id');
        $this->assertDatabaseHas('players', ['id' => $id, 'clan_id' => $clan->id]);
        Player::factory()->create(['clan_id' => Clan::factory()->create()->id, 'normalized_uid' => 'FOREIGN123']);
        $this->postJson("/api/v1/manage/clans/{$clan->id}/players", ['current_ign' => 'Copy', 'uid' => 'foreign 123'])->assertUnprocessable()->assertJsonValidationErrors('uid');
        $this->postJson("/api/v1/manage/squads/{$squad->id}/roster", ['current_ign' => 'Copy', 'uid' => 'foreign 123'])->assertUnprocessable()->assertJsonValidationErrors('uid');
    }

    public function test_organizers_manage_any_clan_and_can_place_unowned_players_without_taking_foreign_players(): void
    {
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*']);
        $clan = Clan::factory()->create();
        $squad = Squad::factory()->for($clan)->create();
        $unowned = Player::factory()->create();
        $foreign = Player::factory()->create(['clan_id' => Clan::factory()->create()->id]);
        $this->actingAs($organizer, 'sanctum')->getJson("/api/v1/manage/clans/{$clan->id}/players")->assertOk();
        $this->postJson("/api/v1/manage/squads/{$squad->id}/roster", ['player_id' => $unowned->id])->assertCreated();
        $this->assertSame($clan->id, $unowned->fresh()->clan_id);
        $this->postJson("/api/v1/manage/squads/{$squad->id}/roster", ['player_id' => $foreign->id])->assertUnprocessable();
    }

    public function test_migration_recovers_current_and_removed_clan_players_without_claiming_conflicting_memberships(): void
    {
        $originalConnection = DB::getDefaultConnection();
        config(['database.connections.clan_upgrade' => ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '', 'foreign_key_constraints' => true]]);
        DB::setDefaultConnection('clan_upgrade');
        try {
            $files = glob(database_path('migrations/*.php'));
            sort($files);
            foreach ($files as $file) {
                if (str_contains($file, 'add_clan_id_to_players_table')) {
                    break;
                }
                (require $file)->up();
            }
            $clan = Clan::factory()->create();
            $squad = Squad::factory()->for($clan)->create();
            $foreign = Squad::factory()->create();
            $active = Player::factory()->create();
            $removed = Player::factory()->create();
            $conflict = Player::factory()->create();
            foreach ([$active, $conflict] as $player) {
                SquadMembership::query()->create(['squad_id' => $squad->id, 'player_id' => $player->id, 'joined_at' => now()]);
            }
            SquadMembership::query()->create(['squad_id' => $squad->id, 'player_id' => $removed->id, 'joined_at' => now()->subDays(2), 'left_at' => now()->subDay()]);
            SquadMembership::query()->create(['squad_id' => $foreign->id, 'player_id' => $conflict->id, 'joined_at' => now()]);
            $migration = require database_path('migrations/2026_11_01_160510_add_clan_id_to_players_table.php');
            $migration->up();
            $this->assertSame($clan->id, $active->fresh()->clan_id);
            $this->assertSame($clan->id, $removed->fresh()->clan_id);
            $this->assertNull($conflict->fresh()->clan_id);
            $this->assertDatabaseCount('squad_memberships', 4);
        } finally {
            DB::setDefaultConnection($originalConnection);
            DB::purge('clan_upgrade');
        }
    }

    public function test_organizer_can_choose_a_clan_but_must_remove_squad_assignments_before_transferring_a_player(): void
    {
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*']);
        $clan = Clan::factory()->create();
        $other = Clan::factory()->create();
        $squad = Squad::factory()->for($clan)->create();
        $this->actingAs($organizer, 'sanctum');
        $id = $this->postJson('/api/v1/manage/players', ['current_ign' => 'Player', 'clan_id' => $clan->id])
            ->assertCreated()->assertJsonPath('data.clan_id', $clan->id)->json('data.id');
        $this->postJson("/api/v1/manage/squads/{$squad->id}/roster", ['player_id' => $id])->assertCreated();
        $this->patchJson("/api/v1/manage/players/{$id}", ['current_ign' => 'Player', 'clan_id' => $other->id])
            ->assertUnprocessable()->assertJsonValidationErrors('clan_id');
        $this->assertDatabaseHas('players', ['id' => $id, 'clan_id' => $clan->id]);
        $this->deleteJson("/api/v1/manage/squads/{$squad->id}/roster/{$id}")->assertNoContent();
        $this->patchJson("/api/v1/manage/players/{$id}", ['current_ign' => 'Player', 'clan_id' => $other->id])
            ->assertOk()->assertJsonPath('data.clan_id', $other->id);
        $this->getJson("/api/v1/manage/clans/{$other->id}/players")->assertOk()->assertJsonPath('data.0.id', $id)->assertJsonCount(0, 'data.0.squads');
    }
}
