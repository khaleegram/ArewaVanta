<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\EventDay;
use App\Models\EventSquad;
use App\Models\RoleAssignment;
use App\Models\ScoringRuleVersion;
use App\Models\Squad;
use App\Models\User;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class EventCheckInReportTest extends TestCase
{
    use LazilyRefreshDatabase;

    private function fixture(): array
    {
        $this->seed(ArewaVantaFoundationSeeder::class);
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*']);
        $event = CompetitionEvent::query()->create([
            'title' => 'Weekend Scrims', 'slug' => 'weekend-check-in', 'competition_type' => 'scrim',
            'timezone' => 'Africa/Lagos', 'squad_capacity' => 10, 'squad_size' => 4,
            'scoring_rule_version_id' => ScoringRuleVersion::query()->firstOrFail()->id, 'track_player_kills' => false,
        ]);
        EventDay::query()->create(['event_id' => $event->id, 'event_date' => '2026-11-07', 'label' => 'Saturday', 'sort_order' => 1]);
        EventDay::query()->create(['event_id' => $event->id, 'event_date' => '2026-11-08', 'label' => 'Sunday', 'sort_order' => 2]);
        $squads = [];
        $clans = [];
        foreach ([8, 2] as $slot) {
            $clan = Clan::factory()->create(['name' => 'Clan '.$slot]);
            $squad = Squad::factory()->for($clan)->create();
            EventSquad::query()->create(['event_id' => $event->id, 'squad_id' => $squad->id, 'status' => 'active', 'slot_number' => $slot]);
            $squads[] = $squad;
            $clans[] = $clan;
        }

        return [$organizer, $event, $squads, $clans];
    }

    public function test_report_lists_assigned_clan_slots_in_order_without_private_fields(): void
    {
        [$organizer, $event] = $this->fixture();
        $unselected = Squad::factory()->create();
        EventSquad::query()->create(['event_id' => $event->id, 'squad_id' => $unselected->id, 'status' => 'removed', 'slot_number' => 3]);
        $response = $this->actingAs($organizer, 'sanctum')->getJson("/api/v1/manage/events/{$event->id}/check-in");
        $response->assertOk()->assertJsonPath('data.event.id', $event->id)->assertJsonCount(2, 'data.event.days')
            ->assertJsonCount(2, 'data.slots')->assertJsonPath('data.slots.0.slot_number', 2)->assertJsonPath('data.slots.1.slot_number', 8)
            ->assertJsonPath('data.slots.1.clan.name', 'Clan 8')->assertJsonMissingPath('data.slots.0.players');
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertStringNotContainsString($organizer->email, $response->getContent());
    }

    public function test_report_uses_current_clan_names_and_excludes_inactive_slots(): void
    {
        [$organizer, $event, $squads, $clans] = $this->fixture();
        $this->actingAs($organizer, 'sanctum')->getJson("/api/v1/manage/events/{$event->id}/check-in")
            ->assertOk()->assertJsonPath('data.slots.1.clan.name', 'Clan 8');
        $clans[0]->update(['name' => 'Renamed Clan']);
        $this->getJson("/api/v1/manage/events/{$event->id}/check-in")->assertOk()
            ->assertJsonPath('data.slots.1.clan.name', 'Renamed Clan');
        EventSquad::query()->where('event_id', $event->id)->where('slot_number', 8)->update(['status' => 'inactive']);
        $this->getJson("/api/v1/manage/events/{$event->id}/check-in")->assertOk()
            ->assertJsonCount(1, 'data.slots')->assertJsonPath('data.slots.0.slot_number', 2);
    }

    public function test_report_is_restricted_to_organizers_with_competition_access(): void
    {
        [$organizer, $event, $squads] = $this->fixture();
        $this->getJson("/api/v1/manage/events/{$event->id}/check-in")->assertUnauthorized();
        $captain = User::factory()->create();
        RoleAssignment::factory()->for($captain)->create(['role' => Role::ClanCaptain->value, 'scope_type' => RoleScope::Clan->value, 'scope_id' => $squads[0]->clan_id]);
        $this->actingAs($captain, 'sanctum')->getJson("/api/v1/manage/events/{$event->id}/check-in")->assertForbidden();
        $scoped = User::factory()->create();
        RoleAssignment::factory()->for($scoped)->create(['role' => Role::Organizer->value, 'scope_type' => RoleScope::Event->value, 'scope_id' => 'another-event']);
        $this->actingAs($scoped, 'sanctum')->getJson("/api/v1/manage/events/{$event->id}/check-in")->assertForbidden();
        RoleAssignment::query()->where('user_id', $scoped->id)->update(['scope_id' => $event->id]);
        $this->getJson("/api/v1/manage/events/{$event->id}/check-in")->assertOk();
    }
}
