<?php

namespace Tests\Feature;

use App\Domain\Competition\ApplySeriesSlots;
use App\Domain\Competition\ManageWeeklyScrims;
use App\Domain\Competition\SaveMatchResults;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\CompetitionSeries;
use App\Models\EventDay;
use App\Models\EventSquad;
use App\Models\EventSquadSubmission;
use App\Models\MatchSquad;
use App\Models\Player;
use App\Models\RoleAssignment;
use App\Models\ScoringRuleVersion;
use App\Models\Squad;
use App\Models\SquadMembership;
use App\Models\User;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class CompetitionSlotsTest extends TestCase
{
    use LazilyRefreshDatabase;

    private function fixture(): array
    {
        $this->travelTo(now('Africa/Lagos')->setDate(2026, 11, 3)->startOfDay());
        $this->seed(ArewaVantaFoundationSeeder::class);
        $actor = User::factory()->create();
        RoleAssignment::factory()->for($actor)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*']);
        $clan = Clan::factory()->create(['status' => 'active']);
        $a = Squad::factory()->for($clan)->create(['name' => 'Squad 1', 'squad_number' => 1, 'status' => 'active']);
        $b = Squad::factory()->for($clan)->create(['name' => 'Squad 2', 'squad_number' => 2, 'status' => 'active']);
        $series = CompetitionSeries::factory()->create(['created_by' => $actor->id, 'next_week_date' => '2026-11-21',
            'default_slots_effective_from' => '2026-11-07', 'default_slot_map' => [['slot' => 1, 'squad_id' => $a->id], ['slot' => 7, 'squad_id' => $b->id], ['slot' => 8, 'squad_id' => null, 'clan_id' => $clan->id]]]);
        $version = ScoringRuleVersion::query()->with(['preset', 'tiers'])->firstOrFail();
        $weeks = [];
        foreach (['2026-10-31', '2026-11-07', '2026-11-14'] as $date) {
            $week = CompetitionEvent::query()->create(['title' => 'Weekly Scrims', 'slug' => 'slots-'.$date, 'competition_type' => 'scrim', 'squad_capacity' => 25, 'squad_size' => 4, 'maximum_position' => 25,
                'timezone' => 'Africa/Lagos', 'visibility' => 'public', 'scoring_rule_version_id' => $version->id, 'created_by' => $actor->id]);
            $week->forceFill(['series_id' => $series->id, 'series_week_date' => $date])->save();
            $day = EventDay::query()->create(['event_id' => $week->id, 'event_date' => $date, 'label' => 'Saturday', 'sort_order' => 1]);
            CompetitionMatch::query()->create(['event_day_id' => $day->id, 'match_index' => 1, 'map_code' => 'blackout', 'map_label' => 'Blackout', 'rules_snapshot' => ['version_id' => $version->id, 'rules' => $version->toScoringRules()->toArray()]]);
            if ($date === '2026-10-31') {
                foreach ([1 => $a, 7 => $b] as $slot => $squad) {
                    EventSquad::query()->create(['event_id' => $week->id, 'squad_id' => $squad->id, 'status' => 'active', 'slot_number' => $slot]);
                    MatchSquad::query()->create(['match_id' => $week->days->first()->matches->first()->id, 'squad_id' => $squad->id, 'entry_status' => 'expected']);
                }
            } else {
                app(ApplySeriesSlots::class)->handle($series, $week);
            }
            $weeks[] = $week;
        }
        $this->actingAs($actor, 'sanctum');

        return [$actor, $series, $weeks, $a, $b, $clan];
    }

    private function payload(CompetitionEvent $week): array
    {
        $data = $this->getJson('/api/v1/manage/events/'.$week->id.'/slots')->assertOk()->json('data');

        return ['expected_version' => $data['version'], 'slots' => array_map(fn ($slot): array => array_intersect_key($slot, array_flip(['slot', 'squad_id', 'reserved_clan_id'])), $data['slots'])];
    }

    public function test_slot_list_includes_assigned_squads_and_reservations_without_any_submissions(): void
    {
        [$actor, $series, $weeks, $a, $b, $clan] = $this->fixture();
        $player = Player::factory()->create(['clan_id' => $clan->id, 'normalized_uid' => 'PRIVATE-UID']);
        SquadMembership::query()->create(['player_id' => $player->id, 'squad_id' => $a->id, 'joined_at' => now()]);
        $response = $this->getJson('/api/v1/manage/events/'.$weeks[1]->id.'/slots')->assertOk()
            ->assertJsonPath('data.event.permanent', true)->assertJsonCount(25, 'data.slots')
            ->assertJsonPath('data.slots.0.squad.id', $a->id)->assertJsonPath('data.slots.6.squad.id', $b->id)
            ->assertJsonPath('data.slots.7.reserved_clan.id', $clan->id)->assertJsonPath('data.slots.0.squad.players.0.id', $player->id);
        $this->assertStringNotContainsString('PRIVATE-UID', $response->getContent());
        $this->assertDatabaseCount('event_squad_submissions', 0);
        $this->getJson('/api/v1/manage/squads/'.$a->id.'/event-submissions')->assertOk()->assertJsonPath('data.opportunities.0.status', 'selected')->assertJsonPath('data.opportunities.0.slot_number', 1)->assertJsonPath('data.opportunities.0.permanent', true);
    }

    public function test_swapping_slots_updates_upcoming_weeks_but_preserves_scored_weekends_and_player_results(): void
    {
        [$actor, $series, $weeks, $a, $b] = $this->fixture();
        $scored = $weeks[1]->days->first()->matches->first();
        $player = Player::factory()->create(['clan_id' => $a->clan_id]);
        $revision = app(SaveMatchResults::class)->handle($actor, $scored, [['squad_id' => $a->id, 'status' => 'present', 'placement' => 2, 'players' => [['player_id' => $player->id, 'kills' => 7]]]], notify: false);
        $before = $revision->fresh()->load('squadResults.playerResults')->toArray();
        $body = $this->payload($weeks[2]);
        $body['slots'][0]['squad_id'] = $b->id;
        $body['slots'][6]['squad_id'] = $a->id;
        $this->putJson('/api/v1/manage/events/'.$weeks[2]->id.'/slots', $body)->assertOk()->assertJsonPath('data.slots.0.squad.id', $b->id)->assertJsonPath('data.slots.6.squad.id', $a->id);
        $this->assertSame($before, $revision->fresh()->load('squadResults.playerResults')->toArray());
        foreach ([$weeks[0], $weeks[1]] as $week) {
            $this->assertSame(1, $week->squadEntries()->where('squad_id', $a->id)->first()->slot_number);
        }
        $this->assertSame(7, $weeks[2]->squadEntries()->where('squad_id', $a->id)->first()->slot_number);
        $this->assertSame($b->id, $series->fresh()->default_slot_map[0]['squad_id']);
    }

    public function test_releasing_one_squad_keeps_other_slots_and_the_reservation_constant_in_new_weeks(): void
    {
        [$actor, $series, $weeks, $a, $b, $clan] = $this->fixture();
        $body = $this->payload($weeks[1]);
        $body['slots'][0]['squad_id'] = null;
        $this->putJson('/api/v1/manage/events/'.$weeks[1]->id.'/slots', $body)->assertOk()->assertJsonPath('data.slots.0.squad_id', null)->assertJsonPath('data.slots.6.squad_id', $b->id)->assertJsonPath('data.slots.7.reserved_clan_id', $clan->id);
        $this->assertDatabaseHas('event_squads', ['event_id' => $weeks[2]->id, 'squad_id' => $a->id, 'status' => 'inactive', 'slot_number' => null]);
        $this->travelTo(now('Africa/Lagos')->setDate(2026, 11, 16)->startOfDay());
        $this->assertSame(1, app(ManageWeeklyScrims::class)->generate($series->fresh()));
        $next = $series->events()->whereDate('series_week_date', '2026-11-21')->firstOrFail();
        $this->assertSame(1, $next->squadEntries()->where('status', 'active')->count());
        $this->assertSame(7, $next->squadEntries()->where('squad_id', $b->id)->first()->slot_number);
        $this->assertFalse($next->squadEntries()->where('squad_id', $a->id)->exists());
    }

    public function test_new_week_keeps_a_high_permanent_slot_when_the_source_week_had_a_smaller_lobby(): void
    {
        [$actor, $series, $weeks, $a] = $this->fixture();
        $series->update(['default_slot_map' => [['slot' => 22, 'squad_id' => $a->id]]]);
        $weeks[2]->update(['squad_capacity' => 10]);
        $this->travelTo(now('Africa/Lagos')->setDate(2026, 11, 16)->startOfDay());
        $this->assertSame(1, app(ManageWeeklyScrims::class)->generate($series->fresh()));
        $next = $series->events()->whereDate('series_week_date', '2026-11-21')->firstOrFail();
        $this->assertSame(22, $next->squad_capacity);
        $this->assertSame(22, $next->squadEntries()->where('squad_id', $a->id)->first()->slot_number);
    }

    public function test_organizer_can_give_a_clan_an_additional_slot_without_changing_past_results(): void
    {
        [$actor, $series, $weeks, $a, $b, $clan] = $this->fixture();
        $match = $weeks[0]->days->first()->matches->first();
        $player = Player::factory()->create(['clan_id' => $clan->id]);
        $revision = app(SaveMatchResults::class)->handle($actor, $match, [['squad_id' => $a->id, 'status' => 'present', 'placement' => 2, 'players' => [['player_id' => $player->id, 'kills' => 7]]]], notify: false);
        $before = $revision->fresh()->load('squadResults.playerResults')->toArray();
        $this->getJson('/api/v1/events/'.$weeks[0]->slug.'/standings')->assertOk()->assertJsonFragment(['slot_number' => 1]);
        $body = $this->payload($weeks[1]);
        $body['slots'][1]['new_clan_id'] = $clan->id;
        $response = $this->putJson('/api/v1/manage/events/'.$weeks[1]->id.'/slots', $body)->assertOk();
        $newEntry = $response->json('data.slots.1.squad.id');
        $this->assertNotEmpty($newEntry);
        $this->assertNotEquals($a->id, $newEntry);
        $this->assertNotEquals($b->id, $newEntry);
        $this->assertDatabaseHas('event_squads', ['event_id' => $weeks[2]->id, 'squad_id' => $newEntry, 'slot_number' => 2, 'status' => 'active']);
        $this->assertSame($before, $revision->fresh()->load('squadResults.playerResults')->toArray());
        $this->putJson('/api/v1/manage/events/'.$weeks[1]->id.'/slots', $body)->assertConflict();
        $this->assertSame(3, $clan->squads()->count());
    }

    public function test_a_new_match_player_is_added_to_the_clan_without_a_squad_membership(): void
    {
        [$actor, $series, $weeks, $a, $b, $clan] = $this->fixture();
        $match = $weeks[1]->days->first()->matches->first();
        $revision = app(SaveMatchResults::class)->handle($actor, $match, [['squad_id' => $a->id, 'status' => 'present', 'players' => [['ign' => 'New player', 'kills' => 5]]]], notify: false);
        $player = Player::query()->where('clan_id', $clan->id)->where('current_ign', 'New player')->firstOrFail();
        $this->assertDatabaseMissing('squad_memberships', ['player_id' => $player->id]);
        $this->assertDatabaseHas('revision_player_results', ['revision_id' => $revision->id, 'player_id' => $player->id, 'kills' => 5]);
    }

    public function test_score_sheet_suggests_the_same_clan_players_for_each_slot(): void
    {
        [$actor, $series, $weeks, $a, $b, $clan] = $this->fixture();
        $player = Player::factory()->create(['clan_id' => $clan->id, 'status' => 'active']);
        SquadMembership::query()->create(['player_id' => $player->id, 'squad_id' => $a->id, 'joined_at' => now()]);
        $match = $weeks[1]->days->first()->matches->first();
        $sheet = $this->getJson('/api/v1/manage/matches/'.$match->id.'/result-sheet')->assertOk()->json('data');
        foreach ($sheet['squads'] as $slot) {
            $this->assertSame([], $slot['roster_players']);
            $this->assertContains($player->id, array_column($slot['eligible_players'], 'id'));
        }
    }

    public function test_partial_slot_score_updates_keep_other_results_and_player_stats(): void
    {
        [$actor, $series, $weeks, $a, $b, $clan] = $this->fixture();
        $match = $weeks[1]->days->first()->matches->first();
        $player = Player::factory()->create(['clan_id' => $clan->id]);
        $first = app(SaveMatchResults::class)->handle($actor, $match, [['squad_id' => $a->id, 'status' => 'present', 'placement' => 2, 'players' => [['player_id' => $player->id, 'kills' => 7]]]], notify: false);
        $updated = app(SaveMatchResults::class)->handle($actor, $match, [['squad_id' => $b->id, 'status' => 'present', 'placement' => null, 'players' => []]], checkVersion: true, expectedLockVersion: $first->lock_version, patchMode: true, notify: false);
        $this->assertDatabaseHas('revision_player_results', ['revision_id' => $updated->id, 'player_id' => $player->id, 'kills' => 7]);
        $this->assertSame(2, $updated->squadResults->firstWhere('squad_id', $a->id)->placement);
        $this->assertNull($updated->squadResults->firstWhere('squad_id', $b->id)->placement);
    }

    public function test_old_edit_versions_duplicate_assignments_and_captain_changes_are_rejected(): void
    {
        [$actor, $series, $weeks, $a, $b, $clan] = $this->fixture();
        $submission = EventSquadSubmission::query()->create(['event_id' => $weeks[1]->id, 'squad_id' => $a->id, 'status' => 'pending', 'submitted_by' => $actor->id, 'submitted_at' => now()]);
        $body = $this->payload($weeks[1]);
        $this->putJson('/api/v1/manage/events/'.$weeks[1]->id.'/squads', ['squad_ids' => []])->assertConflict();
        $duplicate = $body;
        $duplicate['slots'][1]['squad_id'] = $a->id;
        $this->putJson('/api/v1/manage/events/'.$weeks[1]->id.'/slots', $duplicate)->assertUnprocessable()->assertJsonValidationErrors('slots');
        $move = $body;
        $move['slots'][0]['squad_id'] = null;
        $move['slots'][1]['squad_id'] = $a->id;
        $this->putJson('/api/v1/manage/events/'.$weeks[1]->id.'/slots', $move)->assertOk();
        $this->assertSame('selected', $submission->fresh()->status);
        $this->putJson('/api/v1/manage/events/'.$weeks[1]->id.'/slots', $body)->assertConflict();
        $captain = User::factory()->create();
        RoleAssignment::factory()->for($captain)->create(['role' => Role::ClanCaptain->value, 'scope_type' => RoleScope::Clan->value, 'scope_id' => $clan->id]);
        $this->actingAs($captain, 'sanctum')->getJson('/api/v1/manage/events/'.$weeks[1]->id.'/slots')->assertForbidden();
        $this->putJson('/api/v1/manage/events/'.$weeks[1]->id.'/slots', $move)->assertForbidden();
    }
}
