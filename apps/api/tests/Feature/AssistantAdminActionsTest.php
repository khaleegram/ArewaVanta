<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\CompetitionMatch;
use App\Models\EventDay;
use App\Models\EventSquad;
use App\Models\MatchSquad;
use App\Models\Player;
use App\Models\PlayerAlias;
use App\Models\PlayerWarning;
use App\Models\RoleAssignment;
use App\Models\ScoringRuleVersion;
use App\Models\Squad;
use App\Models\User;
use Carbon\Carbon;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AssistantAdminActionsTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_slot_swap_is_previewed_then_saved_only_after_acceptance(): void
    {
        [$organizer, $eventId, , $kano, $sokoto] = $this->competition();
        [$threadId, $proposal] = $this->ask($organizer, $eventId, [['type' => 'move_slot', 'from_slot' => 12, 'to_slot' => 6]]);

        $this->assertSame(12, EventSquad::query()->where('squad_id', $kano->id)->value('slot_number'));
        $this->assertCount(2, $proposal['preview']['items']);

        $this->decide($organizer, $threadId, $proposal['id'], 'accept');

        $this->assertSame(6, EventSquad::query()->where('squad_id', $kano->id)->value('slot_number'));
        $this->assertSame(12, EventSquad::query()->where('squad_id', $sokoto->id)->value('slot_number'));
    }

    public function test_slot_swap_is_refused_if_slots_changed_after_the_preview(): void
    {
        [$organizer, $eventId, , $kano] = $this->competition();
        [$threadId, $proposal] = $this->ask($organizer, $eventId, [['type' => 'move_slot', 'from_slot' => 12, 'to_slot' => 6]]);
        EventSquad::query()->where('squad_id', $kano->id)->update(['slot_number' => 20]);

        $this->decide($organizer, $threadId, $proposal['id'], 'accept', 409);

        $this->assertSame(20, EventSquad::query()->where('squad_id', $kano->id)->value('slot_number'));
    }

    public function test_clan_rename_player_alias_and_warning_are_saved_together_on_acceptance(): void
    {
        [$organizer, $eventId, $clan, , , $player] = $this->competition();
        [$threadId, $proposal] = $this->ask($organizer, $eventId, [
            ['type' => 'update_clan', 'clan_id' => $clan->id, 'name' => 'Kano Kings'],
            ['type' => 'update_player', 'player_id' => $player->id, 'ign' => 'GrBtnessPro'],
            ['type' => 'record_warning', 'player_id' => $player->id, 'severity' => 'warning', 'reason' => 'Late to the lobby'],
        ]);
        $this->assertSame('Kano Clan', $clan->fresh()->name);

        $this->decide($organizer, $threadId, $proposal['id'], 'accept');

        $this->assertSame('Kano Kings', $clan->fresh()->name);
        $this->assertSame('GrBtnessPro', $player->fresh()->current_ign);
        $this->assertTrue(PlayerAlias::query()->where('player_id', $player->id)->where('alias', 'GrBtness')->exists());
        $this->assertSame('Late to the lobby', PlayerWarning::query()->where('player_id', $player->id)->sole()->reason);
    }

    public function test_rejected_actions_change_nothing(): void
    {
        [$organizer, $eventId, $clan] = $this->competition();
        [$threadId, $proposal] = $this->ask($organizer, $eventId, [['type' => 'update_clan', 'clan_id' => $clan->id, 'name' => 'Nope']]);

        $this->decide($organizer, $threadId, $proposal['id'], 'reject');

        $this->assertSame('Kano Clan', $clan->fresh()->name);
    }

    public function test_roster_map_and_merge_actions_apply_together_and_keep_warnings_on_the_kept_profile(): void
    {
        [$organizer, $eventId, $clan, $kano, , $player] = $this->competition();
        $duplicate = Player::factory()->create(['clan_id' => $clan->id, 'current_ign' => 'GrBtnes']);
        PlayerWarning::factory()->create(['player_id' => $duplicate->id, 'reason' => 'Old warning']);
        $matchId = CompetitionMatch::query()->orderBy('id')->value('id');
        $newcomer = Player::factory()->create(['clan_id' => $clan->id, 'current_ign' => 'Newcomer']);
        [$threadId, $proposal] = $this->ask($organizer, $eventId, [
            ['type' => 'add_roster_player', 'squad_id' => $kano->id, 'player_id' => $newcomer->id],
            ['type' => 'set_map', 'match_id' => $matchId, 'map_label' => 'Alcatraz'],
            ['type' => 'merge_players', 'source_id' => $duplicate->id, 'target_id' => $player->id],
        ]);

        $this->decide($organizer, $threadId, $proposal['id'], 'accept');

        $this->assertTrue($kano->memberships()->where('player_id', $newcomer->id)->whereNull('left_at')->exists());
        $this->assertSame('Alcatraz', CompetitionMatch::query()->findOrFail($matchId)->map_label);
        $this->assertNull(Player::query()->find($duplicate->id));
        $this->assertSame('Old warning', PlayerWarning::query()->where('player_id', $player->id)->sole()->reason);
    }

    public function test_adding_a_player_from_another_clan_to_a_roster_is_refused_with_a_warning(): void
    {
        [$organizer, $eventId, , $kano] = $this->competition();
        $outsider = Player::factory()->create(['clan_id' => Clan::factory()->create()->id, 'current_ign' => 'Outsider']);
        Storage::fake('local');
        config(['services.deepseek.key' => 'test-key']);
        Http::fake(['https://api.deepseek.com/chat/completions' => Http::response(['choices' => [['message' => ['content' => json_encode(['reply' => 'Prepared.', 'admin_actions' => [['type' => 'add_roster_player', 'squad_id' => $kano->id, 'player_id' => $outsider->id]]])], 'finish_reason' => 'stop']]])]);
        $thread = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/events/{$eventId}/assistant-threads")->json('data');

        $data = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/assistant-threads/{$thread['id']}/messages", ['client_id' => (string) Str::uuid(), 'message' => 'add him'])->assertOk()->json('data');

        $this->assertSame([], $data['proposals']);
        $this->assertStringContainsString('Permanent clan changes are never made automatically', collect($data['messages'])->last()['details']['warnings'][0]);
    }

    public function test_warning_history_is_organizer_only(): void
    {
        [$organizer, , , , , $player] = $this->competition();
        PlayerWarning::factory()->create(['player_id' => $player->id, 'reason' => 'Spam']);

        $this->actingAs($organizer, 'sanctum')->getJson("/api/v1/manage/players/{$player->id}/warnings")->assertOk()->assertJsonPath('data.0.reason', 'Spam');
        $this->actingAs(User::factory()->create(), 'sanctum')->getJson("/api/v1/manage/players/{$player->id}/warnings")->assertForbidden();
    }

    public function test_accepted_slot_swap_can_be_undone_but_not_over_newer_changes(): void
    {
        [$organizer, $eventId, , $kano, $sokoto] = $this->competition();
        [$threadId, $proposal] = $this->ask($organizer, $eventId, [['type' => 'move_slot', 'from_slot' => 12, 'to_slot' => 6]]);
        $this->decide($organizer, $threadId, $proposal['id'], 'accept');

        $this->decide($organizer, $threadId, $proposal['id'], 'undo');

        $this->assertSame(12, EventSquad::query()->where('squad_id', $kano->id)->value('slot_number'));
        $this->assertSame(6, EventSquad::query()->where('squad_id', $sokoto->id)->value('slot_number'));
        $this->decide($organizer, $threadId, $proposal['id'], 'undo', 409);
    }

    public function test_undo_is_refused_when_the_record_changed_afterwards(): void
    {
        [$organizer, $eventId, $clan] = $this->competition();
        [$threadId, $proposal] = $this->ask($organizer, $eventId, [['type' => 'update_clan', 'clan_id' => $clan->id, 'name' => 'Kano Kings']]);
        $this->decide($organizer, $threadId, $proposal['id'], 'accept');
        $clan->forceFill(['name' => 'Renamed By Someone Else'])->save();

        $this->decide($organizer, $threadId, $proposal['id'], 'undo', 409);

        $this->assertSame('Renamed By Someone Else', $clan->fresh()->name);
    }

    public function test_games_scoring_late_entry_and_squads_can_be_changed_and_undone(): void
    {
        [$organizer, $eventId, $clan, $kano] = $this->competition();
        $matchId = CompetitionMatch::query()->orderBy('id')->value('id');
        $date = EventDay::query()->where('event_id', $eventId)->value('event_date');
        $date = Carbon::parse($date)->toDateString();
        $otherClan = Clan::factory()->create(['name' => 'Late Clan']);
        $games = CompetitionMatch::query()->count();
        $squads = Squad::query()->count();
        $version = ScoringRuleVersion::query()->where('id', '!=', CompetitionMatch::query()->value('scoring_rule_version_id'))->first();

        [$threadId, $proposal] = $this->ask($organizer, $eventId, [
            ['type' => 'add_game', 'date' => $date, 'map_label' => 'Nuketown'],
            ['type' => 'late_entry', 'match_id' => $matchId, 'clan_id' => $otherClan->id, 'slot_number' => 9],
            ['type' => 'create_squad', 'clan_id' => $clan->id],
            ...($version === null ? [] : [['type' => 'set_scoring', 'match_id' => $matchId, 'scoring_rule_version_id' => $version->id]]),
        ]);
        $this->decide($organizer, $threadId, $proposal['id'], 'accept');

        $this->assertSame($games + 1, CompetitionMatch::query()->count());
        $this->assertSame($squads + 2, Squad::query()->count());
        $this->assertSame(9, EventSquad::query()->where('event_id', $eventId)->where('squad_id', '!=', $kano->id)->whereNotNull('slot_number')->where('slot_number', 9)->value('slot_number'));
        $this->decide($organizer, $threadId, $proposal['id'], 'undo', 422);
    }

    public function test_added_game_alone_is_undoable_and_removing_a_game_with_results_is_refused(): void
    {
        [$organizer, $eventId] = $this->competition();
        $date = Carbon::parse(EventDay::query()->where('event_id', $eventId)->value('event_date'))->toDateString();
        $games = CompetitionMatch::query()->count();
        [$threadId, $proposal] = $this->ask($organizer, $eventId, [['type' => 'add_game', 'date' => $date, 'map_label' => 'Nuketown']]);
        $this->decide($organizer, $threadId, $proposal['id'], 'accept');
        $this->assertSame($games + 1, CompetitionMatch::query()->count());

        $this->decide($organizer, $threadId, $proposal['id'], 'undo');

        $this->assertSame($games, CompetitionMatch::query()->count());
    }

    public function test_a_timed_out_thinking_request_is_retried_without_thinking(): void
    {
        [$organizer, $eventId] = $this->competition();
        Storage::fake('local');
        config(['services.deepseek.key' => 'test-key', 'services.deepseek.reasoning_effort' => 'max']);
        Http::fake(['https://api.deepseek.com/chat/completions' => Http::sequence()
            ->pushFailedConnection('cURL error 28: Operation timed out')
            ->push(['choices' => [['message' => ['content' => json_encode(['reply' => 'Answered without deep thinking.'])], 'finish_reason' => 'stop']]])]);
        $thread = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/events/{$eventId}/assistant-threads")->json('data');

        $data = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/assistant-threads/{$thread['id']}/messages", ['client_id' => (string) Str::uuid(), 'message' => 'hello'])->assertOk()->json('data');

        $this->assertSame('Answered without deep thinking.', collect($data['messages'])->last()['content']);
        Http::assertSentCount(2);
        Http::assertSent(fn ($request): bool => ($request['thinking']['type'] ?? '') === 'disabled');
    }

    /** @param list<array<string, mixed>> $actions
     * @return array{string, array<string, mixed>}
     */
    private function ask(User $organizer, string $eventId, array $actions): array
    {
        Storage::fake('local');
        config(['services.deepseek.key' => 'test-key']);
        Http::fake(['https://api.deepseek.com/chat/completions' => Http::response(['choices' => [['message' => ['content' => json_encode(['reply' => 'Prepared.', 'admin_actions' => $actions])], 'finish_reason' => 'stop']]])]);
        $thread = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/events/{$eventId}/assistant-threads")->json('data');
        $data = $this->actingAs($organizer, 'sanctum')->postJson("/api/v1/manage/assistant-threads/{$thread['id']}/messages", [
            'client_id' => (string) Str::uuid(), 'message' => 'do it',
        ])->assertOk()->json('data');

        return [$thread['id'], $data['proposals'][0]];
    }

    private function decide(User $organizer, string $threadId, string $proposalId, string $decision, int $status = 200): void
    {
        $this->actingAs($organizer, 'sanctum')->patchJson("/api/v1/manage/assistant-threads/{$threadId}/proposals/{$proposalId}", ['decision' => $decision])->assertStatus($status);
    }

    /** @return array{User, string, Clan, Squad, Squad, Player} */
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
        $player = Player::factory()->create(['clan_id' => $clanA->id, 'current_ign' => 'GrBtness']);
        $season = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/seasons', ['name' => 'Admin Season'])->assertCreated()->json('data');
        $event = $this->actingAs($organizer, 'sanctum')->postJson('/api/v1/manage/events', ['title' => 'Admin Cup', 'season_id' => $season['id']])->assertCreated()->json('data');
        $matchId = $event['days'][0]['matches'][0]['id'];
        EventSquad::query()->create(['event_id' => $event['id'], 'squad_id' => $squadA->id, 'status' => 'active', 'slot_number' => 12]);
        EventSquad::query()->create(['event_id' => $event['id'], 'squad_id' => $squadB->id, 'status' => 'active', 'slot_number' => 6]);
        MatchSquad::query()->create(['match_id' => $matchId, 'squad_id' => $squadA->id, 'entry_status' => 'expected']);
        MatchSquad::query()->create(['match_id' => $matchId, 'squad_id' => $squadB->id, 'entry_status' => 'expected']);

        return [$organizer, $event['id'], $clanA, $squadA, $squadB, $player];
    }
}
