<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\AssistantProposal;
use App\Models\Clan;
use App\Models\EventSquad;
use App\Models\MatchSquad;
use App\Models\MatchSquadResult;
use App\Models\Player;
use App\Models\RoleAssignment;
use App\Models\Squad;
use App\Models\User;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AssistantScoreboardTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_selected_game_scoreboard_becomes_a_server_prepared_proposal_even_if_the_model_refuses(): void
    {
        [$organizer, $eventId, $matchId, $kanoSquad] = $this->competition();
        $this->fakeProviders(modelReply: ['reply' => 'I cannot tell which game this is.', 'corrections' => []]);

        $thread = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/events/{$eventId}/assistant-threads")->assertCreated()->json('data');
        $response = $this->actingAs($organizer, 'sanctum')->post("/api/v1/manage/assistant-threads/{$thread['id']}/messages", [
            'client_id' => (string) Str::uuid(),
            'message' => 'Extract and enter result for this game',
            'match_id' => $matchId,
            'images' => [UploadedFile::fake()->image('board.png', 1200, 800)],
        ], ['Accept' => 'application/json'])->assertOk();

        $proposal = AssistantProposal::query()->where('thread_id', $thread['id'])->sole();
        $this->assertSame($matchId, $proposal->match_id);
        $rows = collect($proposal->preview['rows']);
        $this->assertCount(2, $rows);
        $kano = $rows->firstWhere('squad_id', $kanoSquad->id);
        $this->assertSame(1, $kano['after']['placement']);
        $this->assertSame(17, $kano['after']['team_kills']);
        $this->assertSame('present', $kano['after']['status']);
        $this->assertNotEmpty($response->json('data.evidence.0.observations'));
        $impact = $proposal->preview['standings'];
        $this->assertSame(2, $impact['teams']);
        $this->assertSame(1, collect($impact['rows'])->firstWhere('squad_id', $kanoSquad->id)['after_rank']);
        $this->assertNull(collect($impact['rows'])->firstWhere('squad_id', $kanoSquad->id)['before_rank'] === 1 ? null : false);
        $this->assertSame(0, MatchSquadResult::query()->count(), 'Projecting standings must not save anything.');
    }

    public function test_one_tap_identity_choice_is_saved_as_an_alias_and_rebuilds_the_review_without_the_model(): void
    {
        [$organizer, $eventId, $matchId] = $this->competition();
        $this->fakeProviders(modelReply: ['reply' => 'Ready.', 'corrections' => []], secondRead: true);
        $thread = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/events/{$eventId}/assistant-threads")->json('data');
        $this->actingAs($organizer, 'sanctum')->post("/api/v1/manage/assistant-threads/{$thread['id']}/messages", [
            'client_id' => (string) Str::uuid(), 'message' => 'enter it', 'match_id' => $matchId,
            'images' => [UploadedFile::fake()->image('board.png', 1200, 800)],
        ], ['Accept' => 'application/json'])->assertOk();
        $first = AssistantProposal::query()->where('thread_id', $thread['id'])->sole();
        $silky = Player::query()->where('current_ign', 'SILKY')->sole();

        $response = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/assistant-threads/{$thread['id']}/messages", [
            'client_id' => (string) Str::uuid(), 'match_id' => $matchId,
            'message' => "TEAM12: \"Mystery Guy\" is SILKY (profile {$silky->id}). Use that profile.",
        ])->assertOk();

        $this->assertDatabaseHas('player_aliases', ['player_id' => $silky->id, 'alias' => 'Mystery Guy', 'source' => 'organizer']);
        $this->assertSame('superseded', $first->fresh()->status);
        $this->assertSame(1, AssistantProposal::query()->where('thread_id', $thread['id'])->where('status', 'pending')->count());
        $reply = collect($response->json('data.messages'))->last();
        $this->assertStringStartsWith('Got it', $reply['content']);
        Http::assertSentCount(3);
    }

    public function test_unknown_slot_team_is_reported_not_entered_and_not_blocking_the_rest(): void
    {
        [$organizer, $eventId, $matchId] = $this->competition();
        $this->fakeProviders(modelReply: ['reply' => 'Ready.', 'corrections' => []], extra: [['team_label' => 'TEAM99', 'team_number' => 99, 'placement' => 3, 'players' => [['name' => 'Nobody', 'kills' => 1]]]]);

        $thread = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/events/{$eventId}/assistant-threads")->json('data');
        $response = $this->actingAs($organizer, 'sanctum')->post("/api/v1/manage/assistant-threads/{$thread['id']}/messages", [
            'client_id' => (string) Str::uuid(), 'message' => 'enter it', 'match_id' => $matchId,
            'images' => [UploadedFile::fake()->image('board.png', 1200, 800)],
        ], ['Accept' => 'application/json'])->assertOk();

        $this->assertSame(1, AssistantProposal::query()->where('thread_id', $thread['id'])->count());
        $warnings = collect($response->json('data.messages'))->last()['details']['warnings'];
        $this->assertTrue(collect($warnings)->contains(fn (string $w): bool => str_contains($w, 'TEAM99')));
    }

    public function test_accepted_scoreboard_correction_can_be_undone_until_someone_edits_the_game(): void
    {
        [$organizer, $eventId, $matchId, $kanoSquad] = $this->competition();
        $this->fakeProviders(modelReply: ['reply' => 'Ready.', 'corrections' => []]);
        $thread = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/events/{$eventId}/assistant-threads")->json('data');
        $this->actingAs($organizer, 'sanctum')->post("/api/v1/manage/assistant-threads/{$thread['id']}/messages", [
            'client_id' => (string) Str::uuid(), 'message' => 'enter it', 'match_id' => $matchId,
            'images' => [UploadedFile::fake()->image('board.png', 1200, 800)],
        ], ['Accept' => 'application/json'])->assertOk();
        $proposal = AssistantProposal::query()->where('thread_id', $thread['id'])->sole();
        $url = "/api/v1/manage/assistant-threads/{$thread['id']}/proposals/{$proposal->id}";

        $this->actingAs($organizer, 'sanctum')->patchJson($url, ['decision' => 'accept'])->assertOk();
        $this->assertSame(2, MatchSquadResult::query()->where('participation_status', 'present')->count());

        $this->actingAs($organizer, 'sanctum')->patchJson($url, ['decision' => 'undo'])->assertOk();

        $this->assertSame(0, MatchSquadResult::query()->where('participation_status', 'present')->where('squad_id', $kanoSquad->id)->count());
        $this->assertSame('undone', $proposal->fresh()->status);
    }

    public function test_organizer_can_edit_a_pending_proposal_and_standings_follow_the_edit(): void
    {
        [$organizer, $eventId, $matchId, $kanoSquad] = $this->competition();
        $this->fakeProviders(modelReply: ['reply' => 'Ready.', 'corrections' => []]);
        $thread = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/events/{$eventId}/assistant-threads")->json('data');
        $this->actingAs($organizer, 'sanctum')->post("/api/v1/manage/assistant-threads/{$thread['id']}/messages", [
            'client_id' => (string) Str::uuid(), 'message' => 'enter it', 'match_id' => $matchId,
            'images' => [UploadedFile::fake()->image('board.png', 1200, 800)],
        ], ['Accept' => 'application/json'])->assertOk();
        $proposal = AssistantProposal::query()->where('thread_id', $thread['id'])->sole();
        $grbtness = Player::query()->where('current_ign', 'GrBtness')->value('id');

        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/assistant-threads/{$thread['id']}/proposals/{$proposal->id}/edit", ['edits' => [[
            'squad_id' => $kanoSquad->id, 'placement' => 2, 'players' => [['player_id' => $grbtness, 'kills' => 20]],
        ]]])->assertOk();

        $kano = collect($proposal->fresh()->preview['rows'])->firstWhere('squad_id', $kanoSquad->id);
        $this->assertSame(2, $kano['after']['placement']);
        $this->assertSame(24, $kano['after']['team_kills']);
        $impact = collect($proposal->fresh()->preview['standings']['rows']);
        $this->assertSame('24', (string) $impact->firstWhere('squad_id', $kanoSquad->id)['total_kills']);
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/assistant-threads/{$thread['id']}/proposals/{$proposal->id}", ['decision' => 'accept'])->assertOk();
        $this->assertSame(2, MatchSquadResult::query()->where('squad_id', $kanoSquad->id)->value('placement'));
    }

    /** @param array<string, mixed> $modelReply
     * @param  list<array<string, mixed>>  $extra
     */
    private function fakeProviders(array $modelReply, array $extra = [], bool $secondRead = false): void
    {
        Storage::fake('local');
        config(['services.deepseek.key' => 'test-key']);
        $reader = ['teams' => [
            ['team_label' => 'TEAM12', 'team_number' => 12, 'placement' => 1, 'players' => [['name' => 'GrBtness', 'kills' => 13], ['name' => 'SomeGuest', 'kills' => 4]]],
            ['team_label' => 'TEAM6', 'team_number' => 6, 'placement' => 2, 'players' => [['name' => 'SILKY', 'kills' => 7]]],
            ...$extra,
        ], 'warnings' => []];
        $sequence = Http::sequence()
            ->push(['choices' => [['message' => ['content' => json_encode($reader)], 'finish_reason' => 'stop']]])
            ->push(['choices' => [['message' => ['content' => json_encode($modelReply)], 'finish_reason' => 'stop']]]);
        if ($secondRead) {
            $sequence->push(['choices' => [['message' => ['content' => json_encode($reader)], 'finish_reason' => 'stop']]]);
        }
        Http::fake(['https://api.deepseek.com/chat/completions' => $sequence]);
    }

    /** @return array{User, string, string, Squad} */
    private function competition(): array
    {
        $this->travelTo(now()->setDate(2026, 10, 27)->setTime(10, 0));
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*']);
        $clanA = Clan::factory()->create(['name' => 'Kano Clan', 'tag' => 'KC']);
        $clanB = Clan::factory()->create(['name' => 'Sokoto Clan', 'tag' => 'SC']);
        $squadA = Squad::factory()->create(['clan_id' => $clanA->id, 'name' => 'Kano Reapers', 'squad_number' => 1, 'tag' => 'KR1']);
        $squadB = Squad::factory()->create(['clan_id' => $clanB->id, 'name' => 'Sokoto Storm', 'squad_number' => 1, 'tag' => 'SS1']);
        Player::factory()->create(['clan_id' => $clanA->id, 'current_ign' => 'GrBtness']);
        Player::factory()->create(['clan_id' => $clanA->id, 'current_ign' => 'SomeGuest']);
        Player::factory()->create(['clan_id' => $clanB->id, 'current_ign' => 'SILKY']);
        $season = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/seasons', ['name' => 'Assistant Season'])->assertCreated()->json('data');
        $event = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', ['title' => 'Assistant Cup', 'season_id' => $season['id']])->assertCreated()->json('data');
        $matchId = $event['days'][0]['matches'][0]['id'];
        EventSquad::query()->create(['event_id' => $event['id'], 'squad_id' => $squadA->id, 'status' => 'active', 'slot_number' => 12]);
        EventSquad::query()->create(['event_id' => $event['id'], 'squad_id' => $squadB->id, 'status' => 'active', 'slot_number' => 6]);
        MatchSquad::query()->create(['match_id' => $matchId, 'squad_id' => $squadA->id, 'entry_status' => 'expected']);
        MatchSquad::query()->create(['match_id' => $matchId, 'squad_id' => $squadB->id, 'entry_status' => 'expected']);

        return [$organizer, $event['id'], $matchId, $squadA];
    }
}
