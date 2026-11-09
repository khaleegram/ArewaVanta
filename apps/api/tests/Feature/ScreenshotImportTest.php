<?php

namespace Tests\Feature;

use App\Domain\Competition\ScreenshotImport\DeepSeekScreenshotReader;
use App\Domain\Competition\ScreenshotImport\ScreenshotResultMapper;
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

    public function test_unique_similar_names_in_the_known_clan_resolve_without_creating_duplicates(): void
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
        $this->assertSame('matched', $team['players'][0]['status']);
        $this->assertSame($playerA->id, $team['players'][0]['player_id']);
        $this->assertSame('Unique similar name in this clan', $team['players'][0]['match_reason']);
    }

    public function test_review_explicit_team_number_keeps_its_assigned_slot(): void
    {
        [$organizer, $matchId, $squadA, $squadB, $playerA] = $this->competition();
        EventSquad::query()->where('squad_id', $squadB->id)->update(['slot_number' => 1]);
        $sheet = $this->actingAs($organizer, 'sanctum')->getJson('/api/v1/manage/matches/'.$matchId.'/result-sheet')->assertOk()->json('data');
        $result = app(ScreenshotResultMapper::class)->map([
            'teams' => [['team_label' => 'TEAM1', 'team_number' => 1, 'placement' => 1, 'players' => [['name' => 'KC | '.$playerA->current_ign, 'kills' => 7]]]],
            'warnings' => [], 'model' => 'review-probe',
        ], $sheet);
        $this->assertSame($squadB->id, $result['teams'][0]['squad']['id'], 'An explicit TEAM1 must map to assigned slot 1, not the clan entry numbered 1 at slot 12.');
    }

    public function test_slot_clan_lookup_does_not_select_the_wrong_tag_duplicate(): void
    {
        [$organizer, $matchId, $squadA] = $this->competition();
        $ne = Clan::factory()->create(['name' => 'Northern Elites', 'tag' => 'NE', 'tags' => ['NE']]);
        $nf = Clan::factory()->create(['name' => 'Night Fall', 'tag' => 'NF', 'tags' => ['NF']]);
        $entry = Squad::factory()->create(['clan_id' => $ne->id, 'squad_number' => 1, 'name' => 'Squad 1']);
        $eventId = $squadA->eventEntries()->first()->event_id;
        EventSquad::query()->create(['event_id' => $eventId, 'squad_id' => $entry->id, 'slot_number' => 13, 'status' => 'active']);
        MatchSquad::query()->create(['match_id' => $matchId, 'squad_id' => $entry->id, 'entry_status' => 'expected']);
        $canonical = Player::factory()->create(['clan_id' => $ne->id, 'current_ign' => 'SAYYID', 'status' => 'active']);
        $duplicate = Player::factory()->create(['clan_id' => $nf->id, 'current_ign' => 'SAYYID', 'status' => 'active']);
        $sheet = $this->actingAs($organizer, 'sanctum')->getJson('/api/v1/manage/matches/'.$matchId.'/result-sheet')->assertOk()->json('data');
        $result = app(ScreenshotResultMapper::class)->map([
            'teams' => [['team_label' => 'TEAM13', 'team_number' => 13, 'placement' => 1, 'players' => [['name' => 'NF | SAYYID', 'kills' => 21]]]],
            'warnings' => [], 'model' => 'review-probe',
        ], $sheet);
        $player = $result['teams'][0]['players'][0];
        $this->assertNull($player['player_id']);
        $this->assertSame('suggested', $player['status']);
        $this->assertTrue($player['tag_conflict']);
        $this->assertSame($canonical->id, $player['candidates'][0]['player_id']);
        $this->assertContains($duplicate->id, array_column($player['candidates'], 'player_id'));
    }

    public function test_review_new_profile_keeps_the_clean_name_after_tag_correction(): void
    {
        [$organizer, $matchId, $squadA] = $this->competition();
        $squadA->clan->update(['tag' => 'NE', 'tags' => ['NE']]);
        Clan::factory()->create(['name' => 'Night Fall', 'tag' => 'NF', 'tags' => ['NF']]);
        $this->actingAs($organizer, 'sanctum')->putJson('/api/v1/manage/matches/'.$matchId.'/results', [
            'results' => [['squad_id' => $squadA->id, 'status' => 'present', 'players' => [['ign' => 'NF | Fresh NE Person', 'clan_id' => $squadA->clan_id, 'kills' => 5]]]],
        ])->assertOk();
        $player = Player::query()->where('clan_id', $squadA->clan_id)->where('current_ign', 'like', '%Fresh NE Person%')->firstOrFail();
        $this->assertSame('Fresh NE Person', $player->current_ign, 'A corrected NE profile must not store the misread NF tag inside its name.');
    }

    public function test_literal_headers_unknown_kills_and_repeated_rows_are_preserved(): void
    {
        config(['services.deepseek.key' => 'test-key']);
        Http::preventStrayRequests();
        Http::fake(['https://api.deepseek.com/chat/completions' => Http::response([
            'choices' => [['message' => ['content' => json_encode(['teams' => [[
                'team_label' => 'TEAM12', 'team_number' => 1, 'placement' => 1, 'source_image' => 1,
                'players' => [
                    ['name' => 'HOLY', 'kills' => 0, 'kills_text' => null],
                    ['name' => 'HOLY', 'kills' => 4, 'kills_text' => '4'],
                ],
            ], [
                'team_label' => 'Unreadable team', 'placement' => 2,
                'players' => [['name' => 'ONE', 'kills' => 1]],
            ], [
                'team_label' => 'Unreadable team', 'placement' => 3,
                'players' => [['name' => 'TWO', 'kills' => 2]],
            ]]], JSON_THROW_ON_ERROR)]]],
        ])]);
        $data = app(DeepSeekScreenshotReader::class)->extract([
            UploadedFile::fake()->image('scores.jpg', 800, 600),
        ]);
        $this->assertCount(3, $data['teams']);
        $team = $data['teams'][0];
        $this->assertSame(12, $team['team_number']);
        $this->assertSame([1], $team['source_images']);
        $this->assertCount(2, $team['players']);
        $this->assertNull($team['players'][0]['kills']);
        $this->assertSame(4, $team['players'][1]['kills']);
        Http::assertSentCount(1);
    }

    public function test_finishing_order_used_as_team_numbers_requires_team_review(): void
    {
        [$organizer, $matchId] = $this->competition();
        $sheet = $this->actingAs($organizer, 'sanctum')->getJson('/api/v1/manage/matches/'.$matchId.'/result-sheet')->assertOk()->json('data');
        $teams = array_map(static fn (int $number): array => [
            'team_label' => 'TEAM'.$number, 'team_number' => $number, 'placement' => $number,
            'players' => [['name' => 'SC | SILKY', 'kills' => 7]],
        ], range(1, 8));
        $data = app(ScreenshotResultMapper::class)->map([
            'teams' => $teams, 'warnings' => [], 'model' => 'test-model',
        ], $sheet);
        $teamSix = collect($data['teams'])->firstWhere('team_number', 6);
        $this->assertSame('roster_mismatch', $teamSix['status']);
        $this->assertNotEmpty($teamSix['review_reasons']);
        $this->assertSame(7, $teamSix['players'][0]['kills']);
    }

    public function test_an_explicit_unassigned_team_does_not_take_a_different_clan_slot(): void
    {
        [$organizer, $matchId] = $this->competition();
        $sheet = $this->actingAs($organizer, 'sanctum')->getJson('/api/v1/manage/matches/'.$matchId.'/result-sheet')->assertOk()->json('data');
        $data = app(ScreenshotResultMapper::class)->map([
            'teams' => [['team_label' => 'TEAM18', 'team_number' => 18, 'placement' => 4,
                'players' => [['name' => 'KC | GrBtness', 'kills' => 9]],
            ]], 'warnings' => [], 'model' => 'test-model',
        ], $sheet);
        $this->assertSame('unassigned', $data['teams'][0]['status']);
        $this->assertNull($data['teams'][0]['squad']);
        $this->assertSame(18, $data['teams'][0]['team_number']);
        $this->assertSame(9, $data['teams'][0]['players'][0]['kills']);
    }

    public function test_partial_imports_keep_known_totals_and_repeated_saves_reuse_profiles(): void
    {
        [$organizer, $matchId, $squadA, , $playerA, $guest] = $this->competition();
        $this->actingAs($organizer, 'sanctum')->putJson('/api/v1/manage/matches/'.$matchId.'/results', [
            'results' => [['squad_id' => $squadA->id, 'status' => 'present', 'placement' => null,
                'team_kills' => 19, 'players' => [['player_id' => $playerA->id, 'kills' => 13]],
            ]],
        ])->assertOk()->assertJsonPath('data.results.0.team_kills', 19);

        $rows = [['squad_id' => $squadA->id, 'status' => 'present', 'placement' => null,
            'team_kills' => 19, 'players' => [
                ['player_id' => $playerA->id, 'kills' => 13],
                ['player_id' => $guest->id, 'kills' => 2],
                ['ign' => 'KC | Fresh Player', 'clan_id' => $squadA->clan_id, 'kills' => 4],
            ],
        ]];
        foreach ([1, 2] as $save) {
            $this->actingAs($organizer, 'sanctum')->putJson('/api/v1/manage/matches/'.$matchId.'/results', [
                'results' => $rows,
            ])->assertOk()->assertJsonPath('data.results.0.team_kills', 19);
        }
        $this->assertSame(1, Player::query()->where('clan_id', $squadA->clan_id)->where('current_ign', 'Fresh Player')->count());
        $this->assertNotSame($squadA->clan_id, $guest->fresh()->clan_id);
        $this->assertSame($guest->clan_id, $guest->fresh()->clan_id);
    }

    public function test_other_clan_majority_is_reviewed_even_when_clan_pools_tie(): void
    {
        [$organizer, $matchId, $squadA, $squadB, $playerA] = $this->competition();
        $extra = Squad::factory()->create(['clan_id' => $squadA->clan_id, 'squad_number' => 2]);
        EventSquad::query()->create(['event_id' => $squadA->eventEntries()->first()->event_id, 'squad_id' => $extra->id, 'status' => 'active', 'slot_number' => 18]);
        MatchSquad::query()->create(['match_id' => $matchId, 'squad_id' => $extra->id, 'entry_status' => 'expected']);
        $second = Player::factory()->create(['clan_id' => $squadA->clan_id, 'current_ign' => 'MOTION']);
        $sheet = $this->actingAs($organizer, 'sanctum')->getJson('/api/v1/manage/matches/'.$matchId.'/result-sheet')->assertOk()->json('data');
        $data = app(ScreenshotResultMapper::class)->map([
            'teams' => [['team_label' => 'TEAM6', 'team_number' => 6, 'placement' => 4, 'players' => [
                ['name' => 'KC | GrBtness', 'kills' => 7], ['name' => 'KC | MOTION', 'kills' => 3],
            ]]], 'warnings' => [], 'model' => 'test-model',
        ], $sheet);
        $team = $data['teams'][0];
        $this->assertSame('roster_mismatch', $team['status']);
        $this->assertSame($squadB->id, $team['squad']['id']);
        $this->assertStringContainsString('Keep this slot for guests', $team['review_reasons'][0]);
        $this->assertSame([$playerA->id, $second->id], array_column($team['players'], 'player_id'));
    }

    public function test_similar_names_with_a_close_runner_up_still_need_a_choice(): void
    {
        [$organizer, $matchId, $squadA] = $this->competition();
        Player::factory()->create(['clan_id' => $squadA->clan_id, 'current_ign' => 'GrBtnesZ']);
        $sheet = $this->actingAs($organizer, 'sanctum')->getJson('/api/v1/manage/matches/'.$matchId.'/result-sheet')->assertOk()->json('data');
        $data = app(ScreenshotResultMapper::class)->map([
            'teams' => [['team_label' => 'TEAM12', 'team_number' => 12, 'placement' => 1,
                'players' => [['name' => 'KC | GrBtnes', 'kills' => 7]],
            ]], 'warnings' => [], 'model' => 'test-model',
        ], $sheet);
        $player = $data['teams'][0]['players'][0];
        $this->assertContains($player['status'], ['suggested', 'ambiguous']);
        $this->assertNull($player['player_id']);
        $this->assertCount(2, $player['candidates']);
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
