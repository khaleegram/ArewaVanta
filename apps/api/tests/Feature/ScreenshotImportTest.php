<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\EventSquad;
use App\Models\MatchSquad;
use App\Models\Player;
use App\Models\RoleAssignment;
use App\Models\Squad;
use App\Models\SquadMembership;
use App\Models\User;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class ScreenshotImportTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_organizer_can_turn_scoreboard_screenshots_into_a_mapped_draft(): void
    {
        [$organizer, $matchId, $squadA, $squadB, $playerA, $playerB] = $this->competition();
        $guestClan = Clan::factory()->create(['name' => 'Guest Clan', 'tag' => 'GC']);
        $guest = Player::factory()->create(['clan_id' => $guestClan->id, 'current_ign' => 'GUEST PLAYER']);

        config(['services.deepseek.key' => 'test-deepseek-key']);
        Http::fake([
            'https://api.deepseek.com/chat/completions' => Http::response([
                'choices' => [[
                    'message' => [
                        'content' => json_encode([
                            'teams' => [
                                [
                                    'team_label' => 'TEAM12',
                                    'team_number' => 12,
                                    'placement' => 1,
                                    'players' => [
                                        ['name' => $playerA->current_ign, 'kills' => 13],
                                        ['name' => 'NEW PLAYER', 'kills' => 4],
                                        ['name' => 'GUEST PLAYER', 'kills' => 2],
                                    ],
                                ],
                                [
                                    'team_label' => 'TEAM6',
                                    'team_number' => 6,
                                    'placement' => 2,
                                    'players' => [
                                        ['name' => $playerB->current_ign, 'kills' => 7],
                                    ],
                                ],
                            ],
                            'warnings' => [],
                        ], JSON_THROW_ON_ERROR),
                    ],
                ]],
            ], 200),
        ]);

        $response = $this->actingAs($organizer, 'sanctum')
            ->post("/api/v1/manage/matches/{$matchId}/screenshot-import", [
                'images' => [UploadedFile::fake()->image('scores.jpg', 1194, 834)],
            ], ['Accept' => 'application/json']);

        $response->assertOk()
            ->assertJsonPath('data.summary.teams', 2)
            ->assertJsonPath('data.summary.matched_teams', 2)
            ->assertJsonPath('data.summary.matched_players', 2)
            ->assertJsonPath('data.summary.new_candidates', 1)
            ->assertJsonPath('data.summary.guest_candidates', 1)
            ->assertJsonFragment([
                'team_label' => 'TEAM12',
                'placement' => 1,
                'slot_number' => 12,
            ])
            ->assertJsonFragment([
                'team_label' => 'TEAM6',
                'placement' => 2,
                'slot_number' => 6,
            ]);

        $teams = $response->json('data.teams');
        $teamTwelve = collect($teams)->firstWhere('team_label', 'TEAM12');
        $this->assertSame($squadA->id, $teamTwelve['squad']['id']);
        $this->assertSame($playerA->id, $teamTwelve['players'][0]['player_id']);
        $this->assertSame('matched', $teamTwelve['players'][0]['status']);
        $this->assertSame('new', $teamTwelve['players'][1]['status']);
        $this->assertSame('other_squad', $teamTwelve['players'][2]['status']);
        $this->assertSame($guest->id, $teamTwelve['players'][2]['player_id']);
        $this->assertSame(19, $teamTwelve['known_kills']);

        $teamSix = collect($teams)->firstWhere('team_label', 'TEAM6');
        $this->assertSame($squadB->id, $teamSix['squad']['id']);
        $this->assertSame($playerB->id, $teamSix['players'][0]['player_id']);

        Http::assertSent(static function ($request): bool {
            $data = $request->data();

            return $request->url() === 'https://api.deepseek.com/chat/completions'
                && $data['model'] === 'deepseek-flash'
                && data_get($data, 'messages.0.content.1.image_url.detail') === 'original';
        });
    }

    public function test_screenshot_import_uses_clan_tags_to_resolve_same_clan_and_guest_players(): void
    {
        [$organizer, $matchId, $squadA, , $playerA] = $this->competition();
        $guestClan = Clan::factory()->create(['name' => 'Guest Clan', 'tag' => 'GC', 'tags' => ['GC']]);
        $guest = Player::factory()->create(['clan_id' => $guestClan->id, 'current_ign' => 'GUEST PLAYER']);
        $nfClan = Clan::factory()->create(['name' => 'NF Clan', 'tag' => 'NF', 'tags' => ['NF']]);
        $neClan = Clan::factory()->create(['name' => 'NE Clan', 'tag' => 'NE', 'tags' => ['NE']]);
        $neSquad = Squad::factory()->create([
            'clan_id' => $neClan->id,
            'name' => 'NE First',
            'squad_number' => 1,
            'tag' => 'NE1',
        ]);
        EventSquad::query()->create(['event_id' => $squadA->eventEntries()->first()->event_id, 'squad_id' => $neSquad->id, 'status' => 'active', 'slot_number' => 13]);
        MatchSquad::query()->create(['match_id' => $matchId, 'squad_id' => $neSquad->id, 'entry_status' => 'expected']);

        config(['services.deepseek.key' => 'test-deepseek-key']);
        Http::fake([
            'https://api.deepseek.com/chat/completions' => Http::response([
                'choices' => [[
                    'message' => [
                        'content' => json_encode([
                            'teams' => [
                                [
                                    'team_label' => 'TEAM12',
                                    'team_number' => 12,
                                    'placement' => 1,
                                    'players' => [
                                        ['name' => 'KC | '.$playerA->current_ign, 'kills' => 13],
                                        ['name' => 'GC | GUEST PLAYER', 'kills' => 2],
                                        ['name' => 'GC | NEW GUEST', 'kills' => 4],
                                        ['name' => 'UnknownTag | LONE WOLF', 'kills' => 1],
                                    ],
                                ],
                                [
                                    'team_label' => 'TEAM13',
                                    'team_number' => 13,
                                    'placement' => 2,
                                    'players' => [
                                        ['name' => 'NF | NEW NE PLAYER', 'kills' => 5],
                                    ],
                                ],
                            ],
                            'warnings' => [],
                        ], JSON_THROW_ON_ERROR),
                    ],
                ]],
            ], 200),
        ]);

        $teams = $this->actingAs($organizer, 'sanctum')
            ->post("/api/v1/manage/matches/{$matchId}/screenshot-import", [
                'images' => [UploadedFile::fake()->image('scores.jpg', 1194, 834)],
            ], ['Accept' => 'application/json'])
            ->assertOk()
            ->json('data.teams');

        $players = collect($teams)->firstWhere('team_label', 'TEAM12')['players'];
        $this->assertSame('KC', $players[0]['tag']);
        $this->assertSame('matched', $players[0]['status']);
        $this->assertSame($playerA->id, $players[0]['player_id']);
        $this->assertSame('GrBtness', $players[0]['ign']);

        $this->assertSame('GC', $players[1]['tag']);
        $this->assertSame('other_squad', $players[1]['status']);
        $this->assertSame($guest->id, $players[1]['player_id']);
        $this->assertSame($guestClan->id, $players[1]['clan_id']);

        $this->assertSame('GC', $players[2]['tag']);
        $this->assertSame('new', $players[2]['status']);
        $this->assertSame('NEW GUEST', $players[2]['ign']);
        $this->assertSame($guestClan->id, $players[2]['clan_id']);

        $this->assertSame('UnknownTag | LONE WOLF', $players[3]['name']);
        $this->assertSame('new', $players[3]['status']);
        $this->assertSame($squadA->clan_id, $players[3]['clan_id']);

        $nePlayers = collect($teams)->firstWhere('team_label', 'TEAM13')['players'];
        $this->assertSame('NE', $nePlayers[0]['tag']);
        $this->assertSame('new', $nePlayers[0]['status']);
        $this->assertSame($neClan->id, $nePlayers[0]['clan_id']);
        $this->assertTrue($nePlayers[0]['tag_conflict']);
        $this->assertNotSame($nfClan->id, $nePlayers[0]['clan_id']);
    }

    public function test_screenshot_import_reports_a_missing_api_key_without_calling_a_provider(): void
    {
        [$organizer, $matchId] = $this->competition();
        config(['services.deepseek.key' => null]);
        Http::fake();

        $this->actingAs($organizer, 'sanctum')
            ->postJson("/api/v1/manage/matches/{$matchId}/screenshot-import", [
                'images' => [UploadedFile::fake()->image('scores.jpg', 800, 600)],
            ])
            ->assertStatus(503)
            ->assertJsonPath('message', 'Screenshot import is not configured. Add DEEPSEEK_API_KEY to the API environment.');

        Http::assertNothingSent();
    }

    public function test_generic_squad_labels_and_fuzzy_names_require_confirmation_instead_of_creating_duplicates(): void
    {
        [$organizer, $matchId, $squadA, , $playerA] = $this->competition();

        config(['services.deepseek.key' => 'test-deepseek-key']);
        Http::fake([
            'https://api.deepseek.com/chat/completions' => Http::response([
                'choices' => [[
                    'message' => [
                        'content' => json_encode([
                            'teams' => [[
                                'team_label' => 'Squad 1',
                                'team_number' => 1,
                                'placement' => 3,
                                'players' => [
                                    ['name' => 'KC | GrBtnes', 'kills' => 8],
                                ],
                            ]],
                            'warnings' => [],
                        ], JSON_THROW_ON_ERROR),
                    ],
                ]],
            ], 200),
        ]);

        $teams = $this->actingAs($organizer, 'sanctum')
            ->post("/api/v1/manage/matches/{$matchId}/screenshot-import", [
                'images' => [UploadedFile::fake()->image('scores.jpg', 1194, 834)],
            ], ['Accept' => 'application/json'])
            ->assertOk()
            ->json('data.teams');

        $team = $teams[0];
        $this->assertSame($squadA->id, $team['squad']['id']);
        $this->assertSame('matched', $team['status']);
        $this->assertSame('suggested', $team['players'][0]['status']);
        $this->assertSame($playerA->id, $team['players'][0]['candidates'][0]['player_id']);
        $this->assertGreaterThanOrEqual(80, $team['players'][0]['candidates'][0]['match_score']);
    }

    /** @return array{User, string, Squad, Squad, Player, Player} */
    private function competition(): array
    {
        $this->travelTo(now()->setDate(2026, 10, 27)->setTime(10, 0));
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create([
            'role' => Role::Organizer->value,
            'scope_type' => RoleScope::Global->value,
            'scope_id' => '*',
        ]);

        $clanA = Clan::factory()->create(['name' => 'Kano Clan', 'tag' => 'KC']);
        $clanB = Clan::factory()->create(['name' => 'Sokoto Clan', 'tag' => 'SC']);
        $squadA = Squad::factory()->create([
            'clan_id' => $clanA->id,
            'name' => 'Kano Reapers',
            'squad_number' => 1,
            'tag' => 'KR1',
        ]);
        $squadB = Squad::factory()->create([
            'clan_id' => $clanB->id,
            'name' => 'Sokoto Storm',
            'squad_number' => 1,
            'tag' => 'SS1',
        ]);
        $playerA = Player::factory()->create(['clan_id' => $clanA->id, 'current_ign' => 'GrBtness']);
        $playerB = Player::factory()->create(['clan_id' => $clanB->id, 'current_ign' => 'SILKY']);
        SquadMembership::query()->create(['squad_id' => $squadA->id, 'player_id' => $playerA->id, 'joined_at' => now()->subMonth()]);
        SquadMembership::query()->create(['squad_id' => $squadB->id, 'player_id' => $playerB->id, 'joined_at' => now()->subMonth()]);

        $season = $this->actingAs($organizer, 'sanctum')
            ->postJson('/api/v1/manage/seasons', ['name' => 'Import Season'])
            ->assertCreated()
            ->json('data');
        $event = $this->actingAs($organizer, 'sanctum')
            ->postJson('/api/v1/manage/events', ['title' => 'Screenshot Cup', 'season_id' => $season['id']])
            ->assertCreated()
            ->json('data');
        $matchId = $event['days'][0]['matches'][0]['id'];

        EventSquad::query()->create(['event_id' => $event['id'], 'squad_id' => $squadA->id, 'status' => 'active', 'slot_number' => 12]);
        EventSquad::query()->create(['event_id' => $event['id'], 'squad_id' => $squadB->id, 'status' => 'active', 'slot_number' => 6]);
        MatchSquad::query()->create(['match_id' => $matchId, 'squad_id' => $squadA->id, 'entry_status' => 'expected']);
        MatchSquad::query()->create(['match_id' => $matchId, 'squad_id' => $squadB->id, 'entry_status' => 'expected']);

        return [$organizer, $matchId, $squadA, $squadB, $playerA, $playerB];
    }
}
