<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class ApiAuthenticationTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_unauthenticated_api_user_request_returns_401(): void
    {
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public function test_login_returns_a_scoped_personal_access_token_and_logout_revokes_it(): void
    {
        $user = User::factory()->create(['password' => 'correct-horse-battery-staple']);

        $response = $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'correct-horse-battery-staple',
            'device_name' => 'test-browser',
        ])->assertOk();

        $token = $response->json('data.token');
        $this->assertIsString($token);
        $this->assertNotEmpty($token);
        $this->assertSame($user->id, $response->json('data.user.id'));

        $this->withToken($token)->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.email', $user->email);
        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertNoContent();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_invalid_login_does_not_issue_a_token(): void
    {
        $user = User::factory()->create(['password' => 'correct-password']);

        $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'wrong-password',
        ])->assertUnprocessable()->assertJsonValidationErrors('email');

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_registration_normalizes_email_and_assigns_only_player_access(): void
    {
        $response = $this->postJson('/api/v1/auth/register', [
            'name' => 'New Player',
            'email' => 'PLAYER@Example.com',
            'password' => 'a sufficiently long password',
            'password_confirmation' => 'a sufficiently long password',
        ])->assertCreated()->assertJsonPath('data.user.email', 'player@example.com');

        $user = User::query()->findOrFail($response->json('data.user.id'));
        $this->assertCount(0, $user->roleAssignments);
        $this->assertFalse($user->isPlatformAdmin());
        $this->postJson('/api/v1/auth/register', [
            'name' => 'Duplicate',
            'email' => 'player@example.com',
            'password' => 'a sufficiently long password',
            'password_confirmation' => 'a sufficiently long password',
        ])->assertUnprocessable()->assertJsonValidationErrors('email');
    }
}
