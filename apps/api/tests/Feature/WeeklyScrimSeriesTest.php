<?php

namespace Tests\Feature;

use App\Domain\Competition\SaveMatchResults;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\CompetitionSeries;
use App\Models\EventSquad;
use App\Models\MatchSquad;
use App\Models\Player;
use App\Models\RoleAssignment;
use App\Models\ScoringPreset;
use App\Models\Squad;
use App\Models\SquadMembership;
use App\Models\User;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Testing\TestResponse;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

final class WeeklyScrimSeriesTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_new_competitions_default_to_weekly_scrims_without_an_enable_action(): void
    {
        [$actor] = $this->scrim();
        $response = $this->postJson('/api/v1/manage/events', ['title' => 'Automatic weekly scrims'])
            ->assertCreated()->assertJsonPath('data.competition_type', 'scrim')
            ->assertJsonPath('data.recurrence.state', 'active')->assertJsonCount(2, 'data.recurrence.weeks');
        $id = $response->json('data.id');
        $series = CompetitionEvent::query()->findOrFail($id)->series;
        $this->assertSame(2, $series->events()->count());
    }

    public function test_custom_weekly_setup_is_saved_atomically_before_future_weeks_are_generated(): void
    {
        [$actor] = $this->scrim();
        $event = $this->postJson('/api/v1/manage/events', [
            'title' => 'One day scrims', 'competition_type' => 'scrim', 'squad_capacity' => 12,
            'days' => [['id' => null, 'date' => '2026-10-31', 'label' => 'Saturday', 'games' => [
                ['id' => null, 'map_code' => 'blackout', 'map_label' => 'Blackout'],
            ]]],
        ])->assertCreated()->assertJsonPath('data.recurrence.state', 'active')->assertJsonCount(1, 'data.days')->json('data');
        $next = CompetitionEvent::query()->where('series_id', $event['recurrence']['id'])->where('id', '!=', $event['id'])->firstOrFail();
        $this->assertSame(12, $next->squad_capacity);
        $this->assertCount(1, $next->days);
        $this->assertCount(1, $next->days->first()->matches);
        $this->assertSame('Blackout', $next->days->first()->matches->first()->map_label);
        $before = CompetitionEvent::query()->count();
        $this->postJson('/api/v1/manage/events', [
            'title' => 'Invalid weekly setup', 'competition_type' => 'scrim',
            'dates' => ['2026-10-31', '2026-11-08'],
        ])->assertUnprocessable()->assertJsonValidationErrors('days');
        $this->assertSame($before, CompetitionEvent::query()->count());
    }

    public function test_existing_scrims_are_adopted_automatically_and_keep_their_slots(): void
    {
        [$actor, $event] = $this->scrim();
        $squad = Squad::factory()->for(Clan::factory())->create(['squad_number' => 1]);
        EventSquad::query()->create(['event_id' => $event->id, 'squad_id' => $squad->id, 'slot_number' => 18, 'status' => 'active']);
        $this->artisan('competitions:generate-weeks')->assertSuccessful();
        $this->assertNotNull($event->fresh()->series_id);
        $this->assertSame(18, $event->squadEntries()->first()->slot_number);
        $this->assertDatabaseCount('events', 2);
        $this->artisan('competitions:generate-weeks')->assertSuccessful();
        $this->assertDatabaseCount('events', 2);
    }

    public function test_weekly_scrims_copy_the_schedule_and_scoring_without_carrying_over_slots_or_results(): void
    {
        [$actor, $event] = $this->scrim();
        $squad = Squad::factory()->for(Clan::factory())->create(['squad_number' => 1]);
        EventSquad::query()->create(['event_id' => $event->id, 'squad_id' => $squad->id, 'slot_number' => 18, 'status' => 'active']);
        $event->days->first()->matches->first()->update(['map_code' => 'blackout', 'map_label' => 'Blackout']);

        $this->recurrence($event, 'start')->assertOk()->assertJsonPath('data.recurrence.state', 'active')->assertJsonCount(2, 'data.recurrence.weeks');
        $next = CompetitionEvent::query()->where('series_id', $event->fresh()->series_id)->where('id', '!=', $event->id)->firstOrFail();
        $this->assertSame('2026-11-07', $next->days->first()->event_date->toDateString());
        $this->assertSame('2026-11-08', $next->days->last()->event_date->toDateString());
        $this->assertSame('Blackout', $next->days->first()->matches->first()->map_label);
        $this->assertSame($event->days->first()->matches->first()->rules_snapshot, $next->days->first()->matches->first()->rules_snapshot);
        $this->assertSame(0, $next->squadEntries()->count());
        $this->assertSame(0, $next->submissions()->count());
        $this->assertNull($next->days->first()->matches->first()->current_published_revision_id);
        $this->assertSame(18, $event->squadEntries()->first()->slot_number);
        $this->recurrence($event->fresh(), 'start')->assertOk();
        $this->artisan('competitions:generate-weeks')->assertSuccessful();
        $this->assertDatabaseCount('events', 2);
        $this->assertDatabaseCount('matches', 12);
    }

    public function test_generation_preserves_custom_game_counts_and_per_game_scoring(): void
    {
        [$actor, $event] = $this->scrim();
        $version = ScoringPreset::query()->where('slug', 'warzone-style-multiplier')->firstOrFail()->versions()->firstOrFail();
        $day = $event->days->first();
        $this->putJson("/api/v1/manage/events/{$event->id}/schedule", ['days' => [[
            'id' => $day->id, 'label' => 'Saturday', 'date' => '2026-10-31',
            'games' => [
                ['id' => $day->matches->first()->id, 'map_code' => 'isolated', 'map_label' => 'Isolated'],
                ['id' => $day->matches->last()->id, 'map_code' => 'blackout', 'map_label' => 'Blackout', 'scoring_rule_version_id' => $version->id],
            ],
        ]]])->assertOk();
        $event->update(['title' => str_repeat('A', 180)]);
        $this->recurrence($event->fresh(), 'start')->assertOk();
        $next = CompetitionEvent::query()->where('id', '!=', $event->id)->firstOrFail();
        $this->assertCount(1, $next->days);
        $this->assertCount(2, $next->days->first()->matches);
        $this->assertSame('multiplier', $next->days->first()->matches->last()->rules_snapshot['rules']['mode']);
        $this->assertLessThanOrEqual(200, strlen($next->slug));
        $this->assertSame('2026-11-07', $next->days->first()->event_date->toDateString());
    }

    public function test_skipping_a_week_is_reversible_and_stops_captain_submissions_and_result_entry(): void
    {
        [$actor, $event] = $this->scrim();
        $this->recurrence($event, 'start')->assertOk();
        $this->recurrence($event->fresh(), 'skip', 'Community break')->assertOk()->assertJsonPath('data.skip_reason', 'Community break');
        $this->getJson("/api/v1/events/{$event->slug}")->assertOk()->assertJsonPath('data.skip_reason', 'Community break');
        $captain = User::factory()->create();
        $clan = Clan::factory()->create();
        RoleAssignment::factory()->for($captain)->create(['role' => Role::ClanCaptain->value, 'scope_type' => RoleScope::Clan->value, 'scope_id' => $clan->id]);
        $squad = Squad::factory()->for($clan)->create(['squad_number' => 1]);
        $this->actingAs($captain, 'sanctum')->postJson("/api/v1/manage/squads/{$squad->id}/event-submissions", ['event_id' => $event->id])
            ->assertUnprocessable()->assertJsonValidationErrors('event_id');
        $opportunities = $this->getJson("/api/v1/manage/squads/{$squad->id}/event-submissions")->assertOk()->json('data.opportunities');
        $this->assertNotContains($event->id, array_column($opportunities, 'id'));
        $this->actingAs($actor, 'sanctum');
        try {
            app(SaveMatchResults::class)->handle($actor, $event->days->first()->matches->first(), []);
            $this->fail('A skipped week must reject new results.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('results', $exception->errors());
        }
        $this->recurrence($event->fresh(), 'restore')->assertOk()->assertJsonPath('data.skipped_at', null);
        $this->assertDatabaseCount('matches', 12);
    }

    public function test_pause_stops_generation_and_resume_preserves_elapsed_and_individually_skipped_weeks(): void
    {
        [$actor, $event] = $this->scrim();
        $this->recurrence($event, 'start')->assertOk();
        $next = CompetitionEvent::query()->where('id', '!=', $event->id)->firstOrFail();
        $this->recurrence($next, 'skip')->assertOk();
        $this->recurrence($event->fresh(), 'pause')->assertOk()->assertJsonPath('data.recurrence.state', 'paused');
        $this->assertSame('pause', $event->fresh()->skip_source);
        $this->travelTo(now()->setDate(2026, 11, 6));
        $this->artisan('competitions:generate-weeks')->assertSuccessful();
        $this->assertDatabaseCount('events', 2);
        $this->recurrence($next->fresh(), 'resume')->assertOk()->assertJsonPath('data.recurrence.state', 'active');
        $this->assertSame('pause', $event->fresh()->skip_source);
        $this->assertSame('week', $next->fresh()->skip_source);
        $this->assertSame(3, CompetitionEvent::query()->count());
        $this->assertTrue(CompetitionEvent::query()->whereDate('series_week_date', '2026-11-14')->whereNull('skipped_at')->exists());
    }

    public function test_resume_reopens_upcoming_weeks_paused_by_the_series(): void
    {
        [$actor, $event] = $this->scrim();
        $this->recurrence($event, 'start')->assertOk();
        $this->recurrence($event->fresh(), 'pause')->assertOk();
        $this->recurrence($event->fresh(), 'resume')->assertOk();
        $this->assertSame(0, CompetitionEvent::query()->whereNotNull('skipped_at')->count());
    }

    public function test_ending_stops_future_weeks_and_keeps_saved_results(): void
    {
        [$actor, $event] = $this->scrim();
        $match = $event->days->first()->matches->first();
        $squad = Squad::factory()->for(Clan::factory())->create(['squad_number' => 1]);
        $player = Player::factory()->create();
        SquadMembership::query()->create(['squad_id' => $squad->id, 'player_id' => $player->id, 'joined_at' => now()->subDay()]);
        EventSquad::query()->create(['event_id' => $event->id, 'squad_id' => $squad->id, 'status' => 'active', 'slot_number' => 1]);
        MatchSquad::query()->create(['match_id' => $match->id, 'squad_id' => $squad->id, 'entry_status' => 'expected']);
        $saved = app(SaveMatchResults::class)->handle($actor, $match, [['squad_id' => $squad->id, 'participation_status' => 'present', 'placement' => 1, 'players' => [['player_id' => $player->id, 'kills' => 7]]]]);
        $this->recurrence($event, 'start')->assertOk();
        $this->recurrence($event->fresh(), 'skip')->assertUnprocessable()->assertJsonValidationErrors('action');
        $this->recurrence($event->fresh(), 'end')->assertOk()->assertJsonPath('data.recurrence.state', 'ended');
        $this->assertNull($event->fresh()->skipped_at);
        $this->assertSame($saved->id, $match->fresh()->current_published_revision_id);
        $this->travelTo(now()->setDate(2026, 12, 1));
        $this->artisan('competitions:generate-weeks')->assertSuccessful();
        $this->assertDatabaseCount('events', 2);
        $this->recurrence($event->fresh(), 'resume')->assertUnprocessable();
        $this->getJson("/api/v1/events/{$event->slug}")->assertOk()->assertJsonPath('data.scored_match_count', 1);
        $this->getJson("/api/v1/players/{$player->id}")->assertOk()->assertJsonPath('data.total_kills', 7)->assertJsonPath('data.appearances', 1);
        $this->getJson("/api/v1/events/{$event->slug}/standings")->assertOk()->assertJsonPath('data.standings.0.total_points', '19');
    }

    public function test_only_global_organizers_and_admins_can_manage_recurring_series(): void
    {
        [$actor, $event] = $this->scrim();
        $this->app['auth']->forgetGuards();
        $this->patchJson("/api/v1/manage/events/{$event->id}/recurrence", ['action' => 'start'])->assertUnauthorized();
        foreach ([Role::ClanCaptain, Role::Organizer] as $role) {
            $user = User::factory()->create();
            RoleAssignment::factory()->for($user)->create(['role' => $role->value, 'scope_type' => $role === Role::ClanCaptain ? RoleScope::Clan->value : RoleScope::Event->value, 'scope_id' => $event->id]);
            $this->actingAs($user, 'sanctum');
            $this->recurrence($event, 'start')->assertForbidden();
        }
        $this->assertDatabaseCount('competition_series', 0);
    }

    public function test_recurrence_validates_actions_scrim_type_and_week_length(): void
    {
        [$actor, $event] = $this->scrim();
        $this->recurrence($event, 'invented')->assertUnprocessable()->assertJsonValidationErrors('action');
        $event->update(['competition_type' => 'tournament']);
        $this->recurrence($event, 'start')->assertUnprocessable()->assertJsonValidationErrors('competition_type');
        $event->update(['competition_type' => 'scrim']);
        $event->days->last()->update(['event_date' => '2026-11-08']);
        $this->recurrence($event->fresh(), 'start')->assertUnprocessable()->assertJsonValidationErrors('days');
        $this->assertDatabaseCount('competition_series', 0);
    }

    public function test_scheduler_uses_the_series_calendar_and_does_not_backfill_closed_weeks(): void
    {
        [$actor, $event] = $this->scrim();
        $this->recurrence($event, 'start')->assertOk();
        $this->travelTo(now()->setDate(2026, 12, 3));
        $this->artisan('competitions:generate-weeks')->assertSuccessful();
        $this->assertDatabaseCount('events', 4);
        $this->assertTrue(CompetitionEvent::query()->whereDate('series_week_date', '2026-12-05')->exists());
        $this->assertTrue(CompetitionEvent::query()->whereDate('series_week_date', '2026-12-12')->exists());
        $this->assertFalse(CompetitionEvent::query()->whereDate('series_week_date', '2026-11-14')->exists());
        $this->assertSame('2026-12-19', CompetitionSeries::query()->firstOrFail()->next_week_date->toDateString());
    }

    /** @return array{User, CompetitionEvent} */
    private function scrim(): array
    {
        $this->travelTo(now()->setDate(2026, 10, 30)->setTime(10, 0));
        $this->seed(ArewaVantaFoundationSeeder::class);
        $actor = User::factory()->create();
        RoleAssignment::factory()->for($actor)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*']);
        $id = $this->actingAs($actor, 'sanctum')->postJson('/api/v1/manage/events', [
            'title' => 'Weekly scrims', 'competition_type' => 'tournament', 'dates' => ['2026-10-31', '2026-11-01'],
        ])->assertCreated()->json('data.id');

        $event = CompetitionEvent::query()->with('days.matches')->findOrFail($id);
        $event->update(['competition_type' => 'scrim']);

        return [$actor, $event];
    }

    private function recurrence(CompetitionEvent $event, string $action, ?string $reason = null): TestResponse
    {
        return $this->patchJson("/api/v1/manage/events/{$event->id}/recurrence", ['action' => $action, 'reason' => $reason]);
    }
}
