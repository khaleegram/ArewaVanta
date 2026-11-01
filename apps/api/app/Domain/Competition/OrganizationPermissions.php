<?php

namespace App\Domain\Competition;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\Clan;
use App\Models\User;

final class OrganizationPermissions
{
    public function canManageAll(User $user): bool
    {
        return $user->isPlatformAdmin() || $user->hasRole(Role::Organizer, RoleScope::Global, '*');
    }

    public function canManageAnyClan(User $user): bool
    {
        return $this->canManageAll($user)
            || $user->roleAssignments()->where('role', Role::Organizer->value)->exists();
    }

    public function canManageClan(User $user, Clan $clan): bool
    {
        return $this->canManageAnyClan($user)
            || $user->hasRole(Role::ClanCaptain, RoleScope::Clan, $clan->id);
    }
}
