<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Enums\Role;
use App\Enums\RoleScope;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    public function roleAssignments(): HasMany
    {
        return $this->hasMany(RoleAssignment::class);
    }

    public function hasRole(Role $role, ?RoleScope $scope = null, ?string $scopeId = null): bool
    {
        return $this->roleAssignments()
            ->where('role', $role->value)
            ->where(function ($query) use ($scope, $scopeId): void {
                $query->where(function ($globalQuery): void {
                    $globalQuery->where('scope_type', RoleScope::Global->value)
                        ->where('scope_id', '*');
                });

                if ($scope !== null && $scope !== RoleScope::Global && $scopeId !== null) {
                    $query->orWhere(function ($scopedQuery) use ($scope, $scopeId): void {
                        $scopedQuery->where('scope_type', $scope->value)
                            ->where('scope_id', $scopeId);
                    });
                }
            })
            ->exists();
    }

    public function isPlatformAdmin(): bool
    {
        return $this->hasRole(Role::PlatformAdmin, RoleScope::Global, '*');
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }
}
