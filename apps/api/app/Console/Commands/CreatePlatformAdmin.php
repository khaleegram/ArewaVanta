<?php

namespace App\Console\Commands;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\AuditLog;
use App\Models\RoleAssignment;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

final class CreatePlatformAdmin extends Command
{
    protected $signature = 'arewavanta:create-admin {email : Administrator email} {--name= : Display name}';

    protected $description = 'Create a platform administrator with an interactively entered password';

    public function handle(): int
    {
        $email = Str::lower(trim((string) $this->argument('email')));
        $name = $this->option('name') ?: $this->ask('Display name');
        $password = $this->secret('Password (at least 12 characters)');
        $confirmation = $this->secret('Confirm password');

        $validator = Validator::make([
            'email' => $email,
            'name' => $name,
            'password' => $password,
            'password_confirmation' => $confirmation,
        ], [
            'email' => ['required', 'email', 'max:255'],
            'name' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'confirmed', Password::min(12)],
        ]);

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }
        if (User::query()->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            $this->error('An account with this email already exists.');

            return self::FAILURE;
        }

        DB::transaction(function () use ($email, $name, $password): void {
            $user = User::query()->create(['name' => $name, 'email' => $email, 'password' => $password]);
            RoleAssignment::query()->create([
                'user_id' => $user->id,
                'role' => Role::PlatformAdmin->value,
                'scope_type' => RoleScope::Global->value,
                'scope_id' => '*',
            ]);
            AuditLog::query()->create([
                'actor_user_id' => $user->id,
                'action' => 'platform_admin_created',
                'entity_type' => 'user',
                'entity_id' => (string) $user->id,
                'after_data' => ['role' => Role::PlatformAdmin->value, 'scope_type' => RoleScope::Global->value],
                'occurred_at' => now(),
            ]);
        });

        $this->info('Platform administrator created.');

        return self::SUCCESS;
    }
}
