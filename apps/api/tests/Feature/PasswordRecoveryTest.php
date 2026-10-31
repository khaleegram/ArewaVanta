<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\PasswordResetNotification;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

final class PasswordRecoveryTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_known_and_unknown_emails_receive_the_same_reset_link_response(): void
    {
        Notification::fake();
        $user = User::factory()->create();

        $knownResponse = $this->postJson('/api/v1/auth/forgot-password', [
            'email' => strtoupper($user->email),
        ])->assertAccepted();
        $unknownResponse = $this->postJson('/api/v1/auth/forgot-password', [
            'email' => 'unknown@example.com',
        ])->assertAccepted();

        $this->assertSame($knownResponse->json('message'), $unknownResponse->json('message'));
        $this->assertSame(
            'If an ArewaVanta account exists for that address, a reset link will be sent.',
            $knownResponse->json('message'),
        );
        Notification::assertSentToOnce($user, PasswordResetNotification::class);
        $this->assertDatabaseHas('password_reset_tokens', ['email' => $user->email]);
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => 'unknown@example.com']);
    }

    public function test_reset_link_changes_password_once_and_revokes_existing_api_tokens(): void
    {
        Notification::fake();
        config(['app.frontend_url' => 'https://arewavanta.com']);
        $user = User::factory()->create(['password' => 'old-password-value']);
        $user->createToken('old-device');

        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])->assertAccepted();
        $notification = Notification::sent($user, PasswordResetNotification::class)->first();
        $this->assertInstanceOf(PasswordResetNotification::class, $notification);
        $mail = $notification->toMail($user);
        parse_str((string) parse_url($mail->viewData['resetUrl'], PHP_URL_QUERY), $query);
        $this->assertSame('https://arewavanta.com/reset-password', strtok($mail->viewData['resetUrl'], '?'));
        $this->assertSame($user->email, $query['email']);
        $this->assertSame($notification->token, $query['token']);
        $this->assertSame('emails.password-reset', $mail->view['html']);
        $this->assertSame('emails.password-reset-text', $mail->view['text']);
        $renderedHtml = view($mail->view['html'], $mail->viewData)->render();
        $renderedText = view($mail->view['text'], $mail->viewData)->render();
        $this->assertStringContainsString('Reset your', $renderedHtml);
        $this->assertStringContainsString('https://arewavanta.com/reset-password?', $renderedHtml);
        $this->assertStringContainsString($mail->viewData['resetUrl'], $renderedText);

        $payload = [
            'email' => $user->email,
            'token' => $notification->token,
            'password' => 'a new secure password',
            'password_confirmation' => 'a new secure password',
        ];
        $this->postJson('/api/v1/auth/reset-password', $payload)
            ->assertOk()
            ->assertJsonPath('message', 'Your password has been reset. Sign in with your new password.');

        $this->assertTrue(Hash::check('a new secure password', $user->fresh()->password));
        $this->assertDatabaseCount('personal_access_tokens', 0);
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => $user->email]);
        $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'a new secure password',
        ])->assertOk();

        $this->postJson('/api/v1/auth/reset-password', $payload)
            ->assertUnprocessable()
            ->assertJsonPath('message', 'This reset link is invalid or has expired.');
    }

    public function test_expired_reset_link_is_rejected_without_changing_the_password(): void
    {
        Notification::fake();
        $user = User::factory()->create(['password' => 'original-password-value']);

        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])->assertAccepted();
        $notification = Notification::sent($user, PasswordResetNotification::class)->first();
        $this->assertInstanceOf(PasswordResetNotification::class, $notification);
        $this->travel(61)->minutes();

        $this->postJson('/api/v1/auth/reset-password', [
            'email' => $user->email,
            'token' => $notification->token,
            'password' => 'a new secure password',
            'password_confirmation' => 'a new secure password',
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'This reset link is invalid or has expired.');

        $this->assertTrue(Hash::check('original-password-value', $user->fresh()->password));
    }

    public function test_password_recovery_is_rate_limited_by_client_ip(): void
    {
        Notification::fake();

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/auth/forgot-password', ['email' => 'unknown@example.com'])
                ->assertAccepted();
        }

        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'unknown@example.com'])
            ->assertTooManyRequests();
    }
}
