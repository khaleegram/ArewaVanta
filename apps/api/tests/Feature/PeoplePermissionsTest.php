<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\CompetitionTemplate;
use App\Models\RoleAssignment;
use App\Models\User;
use Database\Seeders\ArewaVantaFoundationSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class PeoplePermissionsTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_admin_assigns_and_revokes_event_roles_without_losing_the_last_admin(): void
    {
        $this->seed(ArewaVantaFoundationSeeder::class);
        $admin = User::factory()->create();
        $adminRole = RoleAssignment::factory()->for($admin)->create([
            'role' => Role::PlatformAdmin->value, 'scope_type' => RoleScope::Global->value, 'scope_id' => '*',
        ]);
        $eventOrganizer = User::factory()->create();
        $template = CompetitionTemplate::query()->where('slug', 'aga-weekend-default')->firstOrFail();
        $event = $this->actingAs($admin, 'sanctum')->postJson('/api/v1/manage/events', [
            'title' => 'Scoped event', 'competition_template_id' => $template->id, 'dates' => ['2026-10-31', '2026-11-01'],
        ])->assertCreated()->json('data');
        $matchId = $event['days'][0]['matches'][0]['id'];
        $roleData = ['role' => 'organizer', 'scope_type' => 'event', 'scope_id' => $event['id']];

        $this->actingAs($eventOrganizer, 'sanctum')
            ->postJson("/api/v1/manage/people/{$eventOrganizer->id}/roles", $roleData)->assertForbidden();
        $assignment = $this->actingAs($admin, 'sanctum')
            ->postJson("/api/v1/manage/people/{$eventOrganizer->id}/roles", $roleData)
            ->assertCreated()->json('data');
        $this->actingAs($eventOrganizer, 'sanctum')->getJson("/api/v1/manage/matches/{$matchId}/result-sheet")->assertOk();
        $this->actingAs($admin, 'sanctum')
            ->postJson("/api/v1/manage/people/{$eventOrganizer->id}/roles", ['role' => 'clan_captain', 'scope_type' => 'global', 'scope_id' => '*'])
            ->assertUnprocessable()->assertJsonValidationErrors('scope_type');
        $this->actingAs($admin, 'sanctum')
            ->deleteJson("/api/v1/manage/people/{$eventOrganizer->id}/roles/{$assignment['id']}")->assertNoContent();
        $this->actingAs($eventOrganizer, 'sanctum')->getJson("/api/v1/manage/matches/{$matchId}/result-sheet")->assertForbidden();
        $this->actingAs($admin, 'sanctum')
            ->deleteJson("/api/v1/manage/people/{$admin->id}/roles/{$adminRole->id}")
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->assertDatabaseHas('audit_logs', ['action' => 'role_assigned', 'entity_id' => (string) $eventOrganizer->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'role_revoked', 'entity_id' => (string) $eventOrganizer->id]);
        $this->actingAs($admin, 'sanctum')->getJson('/api/v1/manage/audit-logs?action=role_assigned')
            ->assertOk()->assertJsonCount(1, 'data');
        $this->actingAs($eventOrganizer, 'sanctum')->getJson('/api/v1/manage/audit-logs')->assertForbidden();
    }
}
