<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Mail\CaptainInvitation;
use App\Models\Clan;
use App\Models\RoleAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\View;
use Illuminate\Support\Str;
use Tests\TestCase;

final class CaptainInvitationWorkflowTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_admin_invitation_uses_the_configured_frontend_url_expires_and_is_single_use(): void
    {
        Mail::fake();
        config(['mail.default' => 'smtp', 'app.frontend_url' => 'https://arewavanta.example']);
        $admin = User::factory()->create();
        RoleAssignment::factory()->for($admin)->create([
            'role' => Role::PlatformAdmin->value,
            'scope_type' => RoleScope::Global->value,
            'scope_id' => '*',
        ]);
        $clan = Clan::factory()->create(['name' => 'Kano Verification Clan']);
        $email = 'captain-'.Str::lower(Str::random(12)).'@example.test';

        $this->actingAs($admin, 'sanctum')
            ->postJson("/api/v1/manage/clans/{$clan->id}/captain-invitations", ['email' => $email])
            ->assertCreated()->assertJsonPath('message', 'Invitation sent.');

        $invitationUrl = null;
        Mail::assertSent(CaptainInvitation::class, function (CaptainInvitation $mail) use ($email, $clan, &$invitationUrl): bool {
            $this->assertTrue($mail->hasTo($email));
            $this->assertSame($clan->name, $mail->clanName);
            $this->assertStringStartsWith('https://arewavanta.example/captain-invite#', $mail->invitationUrl);
            $html = $mail->render();
            $text = View::make('emails.captain-invitation-text', [
                'clanName' => $clan->name,
                'invitationUrl' => $mail->invitationUrl,
            ])->render();
            $this->assertStringContainsString($clan->name, $html);
            $this->assertStringContainsString('Accept invitation', $html);
            $this->assertStringContainsString('7 days', $html);
            $this->assertStringContainsString($mail->invitationUrl, $text);
            $invitationUrl = $mail->invitationUrl;

            return true;
        });

        $token = Str::after($invitationUrl, '#');
        $this->assertSame(64, strlen($token));
        $this->assertDatabaseHas('clan_captain_invitations', [
            'clan_id' => $clan->id,
            'email' => $email,
            'token_hash' => hash('sha256', $token),
            'accepted_at' => null,
        ]);
        $record = (object) DB::table('clan_captain_invitations')->where('token_hash', hash('sha256', $token))->first();
        $this->assertTrue(now()->addDays(6)->lt($record->expires_at));
        $this->assertTrue(now()->addDays(8)->gt($record->expires_at));

        $this->postJson('/api/v1/captain-invitations/inspect', ['token' => $token])
            ->assertOk()->assertJsonPath('data.clan', $clan->name)->assertJsonPath('data.existing_account', false);
        $accepted = $this->postJson('/api/v1/captain-invitations/accept', [
            'token' => $token,
            'name' => 'Invited Captain',
            'password' => 'Captain-Password-2026!',
            'password_confirmation' => 'Captain-Password-2026!',
        ])->assertOk();
        $this->assertNotEmpty($accepted->json('data.token'));
        $captain = User::query()->where('email', $email)->firstOrFail();
        $this->assertDatabaseHas('role_assignments', [
            'user_id' => $captain->id,
            'role' => Role::ClanCaptain->value,
            'scope_type' => RoleScope::Clan->value,
            'scope_id' => $clan->id,
        ]);
        $this->postJson('/api/v1/captain-invitations/inspect', ['token' => $token])
            ->assertUnprocessable()->assertJsonValidationErrors('token');
        Mail::assertSentCount(1);
    }

    public function test_expired_invitation_cannot_be_inspected_or_accepted(): void
    {
        $admin = User::factory()->create();
        $clan = Clan::factory()->create();
        $token = Str::random(64);
        DB::table('clan_captain_invitations')->insert([
            'clan_id' => $clan->id,
            'email' => 'expired-captain@example.test',
            'token_hash' => hash('sha256', $token),
            'invited_by' => $admin->id,
            'expires_at' => now()->subSecond(),
            'accepted_at' => null,
            'created_at' => now()->subDays(8),
            'updated_at' => now()->subDays(8),
        ]);

        $this->postJson('/api/v1/captain-invitations/inspect', ['token' => $token])
            ->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->postJson('/api/v1/captain-invitations/accept', [
            'token' => $token,
            'name' => 'Expired Captain',
            'password' => 'Captain-Password-2026!',
            'password_confirmation' => 'Captain-Password-2026!',
        ])->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->assertDatabaseMissing('users', ['email' => 'expired-captain@example.test']);
    }

    public function test_non_admin_cannot_send_captain_invitations(): void
    {
        Mail::fake();
        config(['mail.default' => 'smtp']);
        $organizer = User::factory()->create();
        RoleAssignment::factory()->for($organizer)->create([
            'role' => Role::Organizer->value,
            'scope_type' => RoleScope::Global->value,
            'scope_id' => '*',
        ]);
        $clan = Clan::factory()->create();

        $this->actingAs($organizer, 'sanctum')
            ->postJson("/api/v1/manage/clans/{$clan->id}/captain-invitations", ['email' => 'captain@example.test'])
            ->assertForbidden();
        $this->assertDatabaseCount('clan_captain_invitations', 0);
        Mail::assertNothingOutgoing();
    }

    public function test_mail_transport_error_returns_safe_response_and_rolls_back_invitation(): void
    {
        config(['mail.default' => 'smtp']);
        Log::shouldReceive('error')->once();
        $admin = User::factory()->create();
        RoleAssignment::factory()->for($admin)->create([
            'role' => Role::PlatformAdmin->value,
            'scope_type' => RoleScope::Global->value,
            'scope_id' => '*',
        ]);
        $clan = Clan::factory()->create();
        $email = 'delivery-failure@example.test';
        Mail::shouldReceive('to')->once()->with($email)->andThrow(new \RuntimeException('SMTP unavailable'));

        $this->actingAs($admin, 'sanctum')
            ->postJson("/api/v1/manage/clans/{$clan->id}/captain-invitations", ['email' => $email])
            ->assertStatus(503)
            ->assertJsonPath('message', 'Could not send the invitation. Check the mail configuration and try again.');
        $this->assertDatabaseCount('clan_captain_invitations', 0);
    }

    public function test_existing_account_must_prove_its_password_before_accepting_captain_role(): void
    {
        Mail::fake();
        config(['mail.default' => 'smtp', 'app.frontend_url' => 'https://arewavanta.example']);
        $admin = User::factory()->create();
        RoleAssignment::factory()->for($admin)->create([
            'role' => Role::PlatformAdmin->value,
            'scope_type' => RoleScope::Global->value,
            'scope_id' => '*',
        ]);
        $clan = Clan::factory()->create();
        $email = 'existing-captain-'.Str::lower(Str::random(10)).'@example.test';
        $existing = User::factory()->create(['email' => $email, 'password' => Hash::make('Existing-Password-2026!')]);

        $this->actingAs($admin, 'sanctum')
            ->postJson("/api/v1/manage/clans/{$clan->id}/captain-invitations", ['email' => $email])
            ->assertCreated();
        $invitationUrl = null;
        Mail::assertSent(CaptainInvitation::class, function (CaptainInvitation $mail) use (&$invitationUrl): bool {
            $invitationUrl = $mail->invitationUrl;

            return true;
        });
        $token = Str::after($invitationUrl, '#');

        $this->postJson('/api/v1/captain-invitations/accept', [
            'token' => $token,
            'password' => 'Wrong-Password-2026!',
        ])->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->postJson('/api/v1/captain-invitations/accept', [
            'token' => $token,
            'password' => 'Existing-Password-2026!',
        ])->assertOk()->assertJsonPath('data.token', fn (string $token): bool => $token !== '');

        $this->assertSame(1, User::query()->where('email', $email)->count());
        $this->assertDatabaseHas('role_assignments', [
            'user_id' => $existing->id,
            'role' => Role::ClanCaptain->value,
            'scope_type' => RoleScope::Clan->value,
            'scope_id' => $clan->id,
        ]);
    }
}
