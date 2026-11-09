<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\Player;
use App\Models\PlayerAlias;
use App\Models\RoleAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class PlayerDuplicateMergeTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_duplicate_suggestions_can_be_merged_without_losing_the_alias(): void
    {
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create([
            'role' => Role::Organizer->value,
            'scope_type' => RoleScope::Global->value,
            'scope_id' => '*',
        ]);
        $clan = Clan::factory()->create(['name' => 'Alpha Four', 'tag' => 'A4']);
        $target = Player::factory()->create([
            'clan_id' => $clan->id,
            'current_ign' => 'A4FLAMZY',
        ]);
        $source = Player::factory()->create([
            'clan_id' => $clan->id,
            'current_ign' => 'A4FLAMEZY',
        ]);
        $target->forceFill(['created_at' => now()->subWeek()])->save();
        $source->forceFill(['created_at' => now()])->save();

        $this->actingAs($organizer, 'sanctum')
            ->getJson('/api/v1/manage/players/duplicates')
            ->assertOk()
            ->assertJsonFragment(['id' => $source->id, 'current_ign' => 'A4FLAMEZY'])
            ->assertJsonFragment(['id' => $target->id, 'current_ign' => 'A4FLAMZY']);

        $this->actingAs($organizer, 'sanctum')
            ->postJson("/api/v1/manage/players/{$source->id}/merge", [
                'target_id' => $target->id,
            ])
            ->assertOk()
            ->assertJsonPath('data.player.id', $target->id)
            ->assertJsonPath('data.merge.aliases', 1);

        $this->assertDatabaseMissing('players', ['id' => $source->id]);
        $this->assertDatabaseHas('players', ['id' => $target->id]);
        $this->assertSame(
            'A4FLAMEZY',
            PlayerAlias::query()->where('player_id', $target->id)->value('alias'),
        );
    }
}
