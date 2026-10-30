<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Http\Controllers\Controller;
use App\Http\Resources\CompetitionTemplateResource;
use App\Models\CompetitionTemplate;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final class CompetitionTemplateController extends Controller
{
    public function __invoke(Request $request): AnonymousResourceCollection
    {
        $user = $request->user();
        abort_unless(
            $user !== null && ($user->isPlatformAdmin() || $user->hasRole(Role::Organizer, RoleScope::Global, '*')),
            403,
        );

        $templates = CompetitionTemplate::query()
            ->with(['days.games.ruleVersionOverride.preset', 'defaultRuleVersion.preset'])
            ->orderBy('name')
            ->get();

        return CompetitionTemplateResource::collection($templates);
    }
}
