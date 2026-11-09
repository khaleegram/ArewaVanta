<?php

namespace Tests\Feature;

use App\Domain\Competition\ClanTag;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\Player;
use App\Models\RoleAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class ClanTagsTest extends TestCase
{
    use LazilyRefreshDatabase;

    private function organizer(): User
    {
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create([
            'role' => Role::Organizer->value,
            'scope_type' => RoleScope::Global->value,
            'scope_id' => '*',
        ]);

        return $organizer;
    }

    public function test_clan_tags_are_optional_multiple_and_unique(): void
    {
        $this->actingAs($this->organizer(), 'sanctum');

        $first = $this->postJson('/api/v1/manage/clans', [
            'name' => 'Northern Elites',
            'tags' => ['ne', 'NE', 'NElite'],
        ])->assertCreated()
            ->assertJsonPath('data.tag', 'NE')
            ->assertJsonPath('data.tags', ['NE', 'NELITE'])
            ->json('data');

        $this->assertSame(['NE', 'NELITE'], Clan::query()->findOrFail($first['id'])->tagList());
        $this->assertDatabaseHas('clans', ['id' => $first['id'], 'tag' => 'NE']);

        $this->postJson('/api/v1/manage/clans', [
            'name' => 'Copy Cat',
            'tags' => ['X', 'NElite'],
        ])->assertUnprocessable()->assertJsonValidationErrors('tags');

        $this->postJson('/api/v1/manage/clans', ['name' => 'No Tag Team'])
            ->assertCreated()
            ->assertJsonPath('data.tag', null)
            ->assertJsonPath('data.tags', []);

        $this->patchJson("/api/v1/manage/clans/{$first['id']}", [
            'name' => 'Northern Elites',
            'tags' => ['NElite'],
            'bio' => 'Updated',
        ])->assertOk()
            ->assertJsonPath('data.tag', 'NELITE')
            ->assertJsonPath('data.tags', ['NELITE'])
            ->assertJsonPath('data.bio', 'Updated');

        $this->patchJson("/api/v1/manage/clans/{$first['id']}", [
            'name' => 'Northern Elites',
            'tags' => [],
        ])->assertOk()
            ->assertJsonPath('data.tag', null)
            ->assertJsonPath('data.tags', []);
    }

    public function test_player_names_are_stored_without_clan_tags(): void
    {
        $this->actingAs($this->organizer(), 'sanctum');
        $clan = $this->postJson('/api/v1/manage/clans', [
            'name' => 'Northern Elites',
            'tags' => ['NE', 'NElite'],
        ])->assertCreated()->json('data');

        $player = $this->postJson("/api/v1/manage/clans/{$clan['id']}/players", [
            'current_ign' => 'NE | Striker',
        ])->assertCreated()
            ->assertJsonPath('data.current_ign', 'Striker')
            ->json('data');

        $this->patchJson("/api/v1/manage/clans/{$clan['id']}/players/{$player['id']}", [
            'current_ign' => 'NElite · Striker',
        ])->assertOk()->assertJsonPath('data.current_ign', 'Striker');

        $squad = $this->postJson("/api/v1/manage/clans/{$clan['id']}/squads", [])
            ->assertCreated()->json('data');
        $this->postJson("/api/v1/manage/squads/{$squad['id']}/roster", [
            'current_ign' => '[NE] Newcomer',
        ])->assertCreated()->assertJsonPath('data.ign', 'Newcomer');

        $this->assertDatabaseHas('players', ['current_ign' => 'Striker']);
        $this->assertDatabaseHas('players', ['current_ign' => 'Newcomer']);
    }

    public function test_tag_splitting_handles_brackets_prefixes_suffixes_and_plain_names(): void
    {
        $this->assertSame(['tag' => 'NE', 'name' => 'Striker'], ClanTag::split('[NE] Striker', ['NE']));
        $this->assertSame(['tag' => 'NE', 'name' => 'Striker'], ClanTag::split('NE | Striker', ['NE']));
        $this->assertSame(['tag' => 'NE', 'name' => 'Striker'], ClanTag::split('Striker · NE', ['NE']));
        $this->assertSame(['tag' => 'NE', 'name' => 'Striker'], ClanTag::split('NE Striker', ['NE']));
        $this->assertSame(['tag' => null, 'name' => 'Nero'], ClanTag::split('Nero', ['NE']));
        $this->assertSame(['tag' => null, 'name' => 'Player-Name'], ClanTag::split('Player-Name', ['XYZ']));
    }

    public function test_tag_commands_set_and_preview_a_clan(): void
    {
        $clan = Clan::factory()->create([
            'name' => 'Northern Elites',
            'slug' => 'ne',
            'tag' => 'NE',
        ]);
        $player = Player::factory()->create([
            'clan_id' => $clan->id,
            'current_ign' => 'NE・Striker',
        ]);

        $this->artisan('clans:tags', ['slug' => 'ne', 'tags' => ['NE', 'AE']])
            ->assertExitCode(0);
        $this->assertSame(['NE', 'AE'], $clan->fresh()->tagList());

        $this->artisan('players:normalize-tags', ['--clan' => 'ne', '--dry-run' => true])
            ->assertExitCode(0);
        $this->assertSame('NE・Striker', $player->fresh()->current_ign);

        $this->artisan('players:normalize-tags', ['--clan' => 'ne'])
            ->assertExitCode(0);
        $this->assertSame('Striker', $player->fresh()->current_ign);
    }

    public function test_any_tag_option_cleans_a_tag_from_another_clan(): void
    {
        $own = Clan::factory()->create(['name' => 'Dark Empire', 'slug' => 'dark', 'tag' => 'DRK']);
        Clan::factory()->create(['name' => 'Northern Elites', 'slug' => 'ne', 'tag' => 'NE']);
        $player = Player::factory()->create([
            'clan_id' => $own->id,
            'current_ign' => 'NE・ƁṢM.drk¹',
        ]);

        $this->artisan('players:normalize-tags')->assertExitCode(0);
        $this->assertSame('NE・ƁṢM.drk¹', $player->fresh()->current_ign);

        $this->artisan('players:normalize-tags', ['--any-tag' => true, '--dry-run' => true])
            ->assertExitCode(0);
        $this->assertSame('NE・ƁṢM.drk¹', $player->fresh()->current_ign);

        $this->artisan('players:normalize-tags', ['--any-tag' => true])->assertExitCode(0);
        $this->assertSame('ƁṢM.drk¹', $player->fresh()->current_ign);
    }

    public function test_normalize_command_strips_existing_tagged_names(): void
    {
        $clan = Clan::factory()->create(['tag' => 'NE', 'tags' => ['NE', 'NElite']]);
        $player = Player::factory()->create([
            'clan_id' => $clan->id,
            'current_ign' => 'NElite | Legacy Name',
        ]);

        $this->artisan('players:normalize-tags', ['--dry-run' => true])->assertExitCode(0);
        $this->assertSame('NElite | Legacy Name', $player->fresh()->current_ign);

        $this->artisan('players:normalize-tags')->assertExitCode(0);
        $this->assertSame('Legacy Name', $player->fresh()->current_ign);
    }
}
