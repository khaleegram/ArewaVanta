<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\MatchPlayerResult;
use App\Models\MatchResult;
use App\Models\MatchSquadResult;
use App\Models\Player;
use App\Models\RoleAssignment;
use App\Models\ScoringPreset;
use App\Models\Squad;
use App\Models\SquadMembership;
use App\Models\User;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

final class MatchResultWorkflowTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_roster_changes_and_player_rename_preserve_historical_match_statistics(): void
    {
        [$organizer, $event, $squads, $players] = $this->competition();
        $match = $event['days'][0]['matches'][0]['id'];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/results", ['results' => [$this->row($squads[0], $players[0], 1, 7)]])->assertOk();
        $original = $players[0]->current_ign;
        $this->actingAs($organizer, 'sanctum')->deleteJson("/api/v1/manage/squads/{$squads[0]->id}/roster/{$players[0]->id}")->assertNoContent();
        $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/squads/{$squads[1]->id}/roster", ['player_id' => $players[0]->id])->assertCreated();
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/players/{$players[0]->id}", ['current_ign' => 'New IGN', 'uid' => null])->assertOk();
        $this->getJson("/api/v1/players/{$players[0]->id}")->assertOk()->assertJsonPath('data.total_kills', 7)
            ->assertJsonPath('data.appearances', 1)->assertJsonPath('data.match_history.0.ign_snapshot', $original)
            ->assertJsonPath('data.match_history.0.squad_id', $squads[0]->id)->assertJsonPath('data.current_squads.0.id', $squads[1]->id);
        $this->getJson("/api/v1/events/{$event['slug']}/standings")->assertOk()->assertJsonPath('data.standings.0.total_kills', 7);
    }

    public function test_direct_save_edit_scoring_change_and_deletion_update_all_rankings(): void
    {
        [$organizer, $event, $squads, $players, $seasonId] = $this->competition();
        $match = $event['days'][0]['matches'][0]['id'];
        $players[0]->update(['current_ign' => '=Test Player', 'normalized_uid' => 'PRIVATE123']);
        $first = [$this->row($squads[0], $players[0], 2, 10), $this->row($squads[1], $players[1], 1, 0)];

        $this->getJson("/api/v1/events/{$event['slug']}")->assertOk();
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/results", ['results' => $first])
            ->assertOk()->assertJsonFragment(['team_kills' => 10, 'total_points' => '19.0000']);
        $this->getJson("/api/v1/matches/{$match}/standings")->assertOk()
            ->assertJsonPath('data.standings.0.squad_id', $squads[0]->id)
            ->assertJsonPath('data.standings.0.rank', 1);
        $this->getJson("/api/v1/events/{$event['slug']}/standings")
            ->assertOk()->assertJsonPath('data.standings.0.total_points', '19');
        $this->getJson("/api/v1/seasons/{$seasonId}/standings")
            ->assertOk()->assertJsonPath('data.standings.0.total_points', '19');
        $this->getJson("/api/v1/players/{$players[0]->id}")
            ->assertOk()->assertJsonPath('data.total_kills', 10)->assertJsonPath('data.uid', null);
        $this->getJson('/api/v1/rankings/players')->assertOk()->assertJsonPath('data.0.total_kills', 10);

        $players[0]->update(['current_ign' => 'New IGN', 'status' => 'inactive']);
        $edited = [$this->row($squads[0], $players[0], 1, 11), $this->row($squads[1], $players[1], 2, 0)];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/results", ['results' => $edited])->assertOk();
        $this->getJson("/api/v1/events/{$event['slug']}/standings")
            ->assertOk()->assertJsonPath('data.standings.0.total_points', '23');
        $this->getJson("/api/v1/players/{$players[0]->id}")
            ->assertOk()->assertJsonPath('data.appearances', 1)->assertJsonPath('data.total_kills', 11)
            ->assertJsonPath('data.match_history.0.ign_snapshot', '=Test Player');

        $warzone = ScoringPreset::query()->where('slug', 'warzone-style-multiplier')->firstOrFail()->versions()->firstOrFail();
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/matches/{$match}/scoring", ['scoring_rule_version_id' => $warzone->id])->assertOk();
        $this->getJson("/api/v1/events/{$event['slug']}/standings")
            ->assertOk()->assertJsonPath('data.standings.0.total_points', '22.0');
        $this->getJson("/api/v1/seasons/{$seasonId}/standings")
            ->assertOk()->assertJsonPath('data.standings.0.total_points', '22.0');
        $csv = $this->actingAs($organizer, 'sanctum')->get("/api/v1/manage/events/{$event['id']}/export/results")->assertOk()->streamedContent();
        $this->assertStringContainsString("'=Test Player", $csv);

        $this->actingAs($organizer, 'sanctum')->deleteJson("/api/v1/manage/events/{$event['id']}")->assertNoContent();
        $this->getJson("/api/v1/events/{$event['slug']}")->assertNotFound();
        $this->getJson("/api/v1/matches/{$match}/results")->assertNotFound();
        $this->getJson("/api/v1/players/{$players[0]->id}")->assertOk()->assertJsonPath('data.appearances', 0);
        $this->getJson("/api/v1/seasons/{$seasonId}/standings")->assertOk()->assertJsonCount(0, 'data.standings');
        $this->assertSoftDeleted('events', ['id' => $event['id']]);
        $this->assertDatabaseHas('revision_player_results', ['player_id' => $players[0]->id, 'kills' => 11]);
        $this->assertDatabaseCount('match_result_revisions', 1);
    }

    public function test_results_validate_placements_rosters_and_permissions_without_partial_writes(): void
    {
        [$organizer, $event, $squads, $players] = $this->competition();
        $match = $event['days'][0]['matches'][0]['id'];
        $invalid = [$this->row($squads[0], $players[0], 1, 1), $this->row($squads[1], $players[1], 1, 2)];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/results", ['results' => $invalid])
            ->assertUnprocessable()->assertJsonValidationErrors('results');
        $invalid[1]['placement'] = 2;
        $invalid[1]['players'][0]['player_id'] = $players[0]->id;
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/results", ['results' => $invalid])
            ->assertUnprocessable()->assertJsonValidationErrors('results');
        $otherUser = User::factory()->create();
        $this->actingAs($otherUser, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/results", ['results' => [$invalid[0]]])->assertForbidden();
        $this->assertDatabaseCount('match_result_revisions', 0);
        $this->getJson("/api/v1/matches/{$match}/results")->assertNotFound();
    }

    public function test_schedule_and_squad_changes_work_after_results_have_been_saved(): void
    {
        [$organizer, $event, $squads, $players, $seasonId] = $this->competition();
        $first = $event['days'][0]['matches'][0]['id'];
        $second = $event['days'][0]['matches'][1]['id'];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$first}/results", ['results' => [
            $this->row($squads[0], $players[0], 2, 10), $this->row($squads[1], $players[1], 1, 1),
        ]])->assertOk();
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$second}/results", ['results' => [
            $this->row($squads[0], $players[0], 1, 1),
        ]])->assertOk();
        $this->getJson("/api/v1/seasons/{$seasonId}/standings")->assertJsonPath('data.standings.0.total_points', '32');
        $warzone = ScoringPreset::query()->where('slug', 'warzone-style-multiplier')->firstOrFail()->versions()->firstOrFail();
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/events/{$event['id']}", [
            'scoring_rule_version_id' => $warzone->id,
        ])->assertOk();
        $this->getJson("/api/v1/seasons/{$seasonId}/standings")->assertJsonPath('data.standings.0.total_points', '20.0');

        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/events/{$event['id']}/schedule", [
            'days' => [['id' => $event['days'][0]['id'], 'date' => '2026-11-05', 'label' => 'Finals', 'games' => [
                ['id' => $first, 'map_code' => 'blackout', 'map_label' => 'Blackout'],
                ['id' => null, 'map_code' => 'isolated', 'map_label' => 'Isolated'],
            ]]],
        ])->assertOk()->assertJsonPath('data.days.0.matches.0.id', $first)->assertJsonPath('data.days.0.matches.0.map_label', 'Blackout')
            ->assertJsonPath('data.days.0.matches.1.has_results', false);
        $this->getJson("/api/v1/events/{$event['slug']}/standings")->assertOk()->assertJsonPath('data.standings.0.total_points', '18.0');
        $this->getJson("/api/v1/players/{$players[0]->id}")->assertJsonPath('data.total_kills', 10);
        $this->assertSoftDeleted('matches', ['id' => $second]);
        $this->assertDatabaseHas('revision_player_results', ['player_id' => $players[0]->id, 'kills' => 1]);

        $newSquad = Squad::factory()->for($squads[0]->clan)->create();
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/events/{$event['id']}/squads", [
            'squad_ids' => [$squads[0]->id, $newSquad->id],
        ])->assertOk()->assertJsonCount(2, 'data.squads');
        $this->getJson("/api/v1/events/{$event['slug']}/standings")->assertOk()
            ->assertJsonPath('data.standings.0.squad.id', $squads[0]->id)
            ->assertJsonPath('data.standings.0.total_points', '18.0');
        $this->getJson("/api/v1/players/{$players[1]->id}")->assertJsonPath('data.appearances', 0);
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/events/{$event['id']}", ['title' => 'Updated competition'])
            ->assertOk()->assertJsonPath('data.title', 'Updated competition');
    }

    public function test_seasons_only_include_their_own_events(): void
    {
        [$organizer, $firstEvent, $squads, $players, $firstSeason] = $this->competition();
        $secondSeason = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/seasons', ['name' => 'Season Two'])->assertCreated()->json('data.id');
        $secondEvent = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', [
            'title' => 'Other weekend', 'season_id' => $secondSeason,
        ])->assertCreated()->json('data');
        $firstMatch = $firstEvent['days'][0]['matches'][0]['id'];
        $secondMatch = $secondEvent['days'][0]['matches'][0]['id'];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$firstMatch}/results", [
            'results' => [$this->row($squads[0], $players[0], 1, 3)],
        ])->assertOk();
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$secondMatch}/results", [
            'results' => [$this->row($squads[0], $players[0], 1, 4)],
        ])->assertOk();

        $this->getJson("/api/v1/seasons/{$firstSeason}/standings")->assertOk()->assertJsonPath('data.standings.0.total_points', '15');
        $this->getJson("/api/v1/seasons/{$secondSeason}/standings")->assertOk()->assertJsonPath('data.standings.0.total_points', '16');
        $this->getJson("/api/v1/players/{$players[0]->id}")->assertOk()
            ->assertJsonPath('data.total_kills', 7)->assertJsonPath('data.appearances', 2)->assertJsonPath('data.kills_per_appearance', '3.50');
    }

    public function test_tied_squads_with_no_common_game_keep_the_same_rank(): void
    {
        [$organizer, $event, $squads, $players] = $this->competition();
        $thirdSquad = Squad::factory()->for($squads[0]->clan)->create();
        $thirdPlayer = Player::factory()->create();
        SquadMembership::query()->create(['squad_id' => $thirdSquad->id, 'player_id' => $thirdPlayer->id, 'joined_at' => now()->subMonth()]);
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/events/{$event['id']}/squads", [
            'squad_ids' => [$squads[0]->id, $squads[1]->id, $thirdSquad->id],
        ])->assertOk();
        $killsOnly = ScoringPreset::query()->where('slug', 'kills-only')->firstOrFail()->versions()->firstOrFail();
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/events/{$event['id']}", [
            'scoring_rule_version_id' => $killsOnly->id,
        ])->assertOk();
        $first = $event['days'][0]['matches'][0]['id'];
        $second = $event['days'][0]['matches'][1]['id'];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$first}/results", ['results' => [
            $this->row($squads[0], $players[0], 6, 0), $this->row($squads[1], $players[1], 7, 0),
        ]])->assertOk();
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$second}/results", ['results' => [
            $this->row($squads[0], $players[0], 6, 0), $this->row($thirdSquad, $thirdPlayer, 7, 0),
        ]])->assertOk();

        $standings = $this->getJson("/api/v1/events/{$event['slug']}/standings")->assertOk()->json('data.standings');
        $this->assertSame([1, 1, 1], array_column($standings, 'rank'));
        $this->assertSame([null, null, null], array_column($standings, 'tie_break_position_sum'));
    }

    public function test_private_event_results_appear_only_in_organizer_season_standings(): void
    {
        [$organizer, , $squads, $players] = $this->competition();
        $season = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/seasons', ['name' => 'Private season'])->assertCreated()->json('data.id');
        $event = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', [
            'title' => 'Private competition', 'season_id' => $season, 'visibility' => 'private',
        ])->assertCreated()->json('data');
        $match = $event['days'][0]['matches'][0]['id'];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/results", [
            'results' => [$this->row($squads[0], $players[0], 1, 4)],
        ])->assertOk();

        $this->getJson("/api/v1/matches/{$match}/results")->assertNotFound();
        $this->getJson("/api/v1/seasons/{$season}/standings")->assertOk()->assertJsonCount(0, 'data.standings');
        $this->actingAs($organizer, 'sanctum')->getJson("/api/v1/manage/seasons/{$season}/standings")
            ->assertOk()->assertJsonPath('data.standings.0.total_points', '16');
        $this->getJson("/api/v1/players/{$players[0]->id}")->assertOk()->assertJsonPath('data.total_kills', 0);
    }

    public function test_organizer_can_change_a_scored_match_squad_list_and_save_it_again(): void
    {
        [$organizer, $event, $squads, $players] = $this->competition();
        $match = $event['days'][0]['matches'][0]['id'];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/results", ['results' => [
            $this->row($squads[0], $players[0], 2, 10), $this->row($squads[1], $players[1], 1, 1),
        ]])->assertOk();
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/squads", [
            'squad_ids' => [$squads[0]->id],
        ])->assertOk()->assertJsonCount(1, 'data.squads');
        $this->getJson("/api/v1/players/{$players[1]->id}")->assertOk()->assertJsonPath('data.appearances', 0);
        $this->getJson("/api/v1/events/{$event['slug']}/standings")->assertJsonPath('data.standings.0.total_points', '19');
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/squads", [
            'squad_ids' => [$squads[0]->id, $squads[1]->id],
        ])->assertOk()->assertJsonCount(2, 'data.squads');
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$match}/results", ['results' => [
            $this->row($squads[0], $players[0], 2, 10), $this->row($squads[1], $players[1], 1, 2),
        ]])->assertOk();
        $this->getJson("/api/v1/players/{$players[1]->id}")->assertOk()->assertJsonPath('data.total_kills', 2);
    }

    public function test_reordering_games_preserves_scores_and_rejects_foreign_game_ids(): void
    {
        [$organizer, $event, $squads, $players] = $this->competition();
        $first = $event['days'][0]['matches'][0]['id'];
        $second = $event['days'][0]['matches'][1]['id'];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$first}/results", [
            'results' => [$this->row($squads[0], $players[0], 2, 10)],
        ])->assertOk();
        $schedule = ['days' => [[
            'id' => $event['days'][0]['id'], 'date' => '2026-11-06', 'label' => 'Reordered',
            'games' => [
                ['id' => $second, 'map_code' => 'isolated', 'map_label' => 'Isolated'],
                ['id' => $first, 'map_code' => 'blackout', 'map_label' => 'Blackout'],
            ],
        ]]];
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/events/{$event['id']}/schedule", $schedule)
            ->assertOk()->assertJsonPath('data.days.0.matches.0.id', $second)->assertJsonPath('data.days.0.matches.1.id', $first);
        $this->getJson("/api/v1/matches/{$first}/results")->assertOk()->assertJsonPath('data.match.match_index', 2);
        $this->getJson("/api/v1/events/{$event['slug']}/standings")->assertOk()->assertJsonPath('data.standings.0.total_points', '19');

        $schedule['days'][0]['games'][0]['id'] = (string) Str::ulid();
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/events/{$event['id']}/schedule", $schedule)
            ->assertUnprocessable()->assertJsonValidationErrors('days');
        $this->getJson("/api/v1/matches/{$first}/results")->assertOk();
    }

    public function test_existing_unfinished_result_can_be_opened_and_saved_directly(): void
    {
        [$organizer, $event, $squads, $players] = $this->competition();
        $matchId = $event['days'][0]['matches'][0]['id'];
        $legacy = MatchResult::query()->create([
            'match_id' => $matchId, 'revision_number' => 1, 'status' => 'submitted',
            'idempotency_key' => (string) Str::ulid(), 'authored_by' => $organizer->id,
        ]);
        $squadResult = MatchSquadResult::query()->create([
            'revision_id' => $legacy->id, 'match_id' => $matchId, 'squad_id' => $squads[0]->id,
            'squad_name_snapshot' => $squads[0]->name, 'participation_status' => 'present',
            'placement' => 2, 'team_kills' => 10, 'kill_points' => '10', 'placement_points' => '9', 'total_points' => '19',
        ]);
        MatchPlayerResult::query()->create([
            'revision_id' => $legacy->id, 'match_squad_result_id' => $squadResult->id,
            'player_id' => $players[0]->id, 'ign_snapshot' => 'Former IGN', 'kills' => 10,
        ]);
        $players[0]->update(['status' => 'inactive', 'current_ign' => 'Changed IGN']);

        $this->actingAs($organizer, 'sanctum')->getJson("/api/v1/manage/matches/{$matchId}/result-sheet")
            ->assertOk()->assertJsonFragment(['player_id' => $players[0]->id, 'ign' => 'Former IGN', 'kills' => 10]);
        $this->actingAs($organizer, 'sanctum')->putJson("/api/v1/manage/matches/{$matchId}/results", [
            'results' => [$this->row($squads[0], $players[0], 2, 10)],
        ])->assertOk();
        $this->assertDatabaseHas('matches', ['id' => $matchId, 'current_published_revision_id' => $legacy->id]);
        $this->assertDatabaseCount('match_result_revisions', 1);
        $this->getJson("/api/v1/events/{$event['slug']}/standings")->assertOk()->assertJsonPath('data.standings.0.total_points', '19');
    }

    /** @return array{User, array, array<Squad>, array<Player>, string} */
    private function competition(): array
    {
        $this->travelTo(now()->setDate(2026, 10, 27)->setTime(10, 0));
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*']);
        $clan = Clan::factory()->create();
        $squads = Squad::factory()->count(2)->for($clan)->create()->all();
        $players = [];
        foreach ($squads as $squad) {
            $player = Player::factory()->create();
            SquadMembership::query()->create(['squad_id' => $squad->id, 'player_id' => $player->id, 'joined_at' => now()->subMonth()]);
            $players[] = $player;
        }
        $season = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/seasons', ['name' => 'Season One'])->assertCreated()->json('data');
        $event = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', ['title' => 'Weekend One', 'season_id' => $season['id']])
            ->assertCreated()->assertJsonPath('data.days.0.date', '2026-10-31')->assertJsonCount(3, 'data.days.0.matches')->json('data');

        return [$organizer, $event, $squads, $players, $season['id']];
    }

    private function row(Squad $squad, Player $player, int $place, int $kills): array
    {
        return ['squad_id' => $squad->id, 'placement' => $place, 'players' => [['player_id' => $player->id, 'kills' => $kills]]];
    }
}
