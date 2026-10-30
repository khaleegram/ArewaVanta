<?php

namespace App\Domain\Competition;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\CompetitionEvent;
use App\Models\User;

final class ResultPermissions
{
    public function canManage(User $user, CompetitionEvent $event): bool
    {
        return $user->isPlatformAdmin()
            || $user->hasRole(Role::Organizer, RoleScope::Event, $event->id);
    }
}
