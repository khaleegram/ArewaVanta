<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

final class CreatePlatformAdminTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_admin_can_be_created_without_a_default_password(): void
    {
        $this->artisan('arewavanta:create-admin', ['email' => 'ADMIN@example.com', '--name' => 'ArewaVanta Admin'])
            ->expectsQuestion('Password (at least 12 characters)', 'a sufficiently long password')
            ->expectsQuestion('Confirm password', 'a sufficiently long password')
            ->assertSuccessful();

        $admin = User::query()->where('email', 'admin@example.com')->firstOrFail();
        $this->assertTrue(Hash::check('a sufficiently long password', $admin->password));
        $this->assertTrue($admin->hasRole(Role::PlatformAdmin, RoleScope::Global, '*'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform_admin_created', 'entity_id' => (string) $admin->id]);
    }
}
