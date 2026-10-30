<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ResultPermissions;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Http\Controllers\Controller;
use App\Http\Resources\CompetitionEventResource;
use App\Models\CompetitionEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class EventQueriesController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $globalAccess = $user->isPlatformAdmin()
            || $user->hasRole(Role::Organizer, RoleScope::Global, '*');
        $assignedEventIds = $user->roleAssignments()
            ->where('role', Role::Organizer->value)
            ->where('scope_type', RoleScope::Event->value)
            ->pluck('scope_id');

        abort_unless($globalAccess || $assignedEventIds->isNotEmpty(), 403);

        $events = CompetitionEvent::query()
            ->with(['season', 'days.matches'])
            ->when(! $globalAccess, fn ($query) => $query->whereIn('id', $assignedEventIds))
            ->orderByDesc('created_at')
            ->paginate(20);

        return response()->json([
            'data' => $events->getCollection()->map(static function (CompetitionEvent $event): array {
                $matches = $event->days->flatMap(static fn ($day) => $day->matches);

                return [
                    'id' => $event->id,
                    'title' => $event->title,
                    'slug' => $event->slug,
                    'visibility' => $event->visibility,
                    'season' => $event->season === null ? null : ['id' => $event->season->id, 'name' => $event->season->name],
                    'start_date' => $event->days->first()?->event_date->toDateString(),
                    'match_count' => $matches->count(),
                    'scored_match_count' => $matches->whereNotNull('current_published_revision_id')->count(),
                ];
            })->values(),
            'meta' => ['current_page' => $events->currentPage(), 'last_page' => $events->lastPage(), 'total' => $events->total()],
        ]);
    }

    public function show(Request $request, CompetitionEvent $event, ResultPermissions $permissions): CompetitionEventResource
    {
        abort_unless($permissions->canManage($request->user(), $event), 403);

        return new CompetitionEventResource($event->load([
            'season',
            'scoringRuleVersion.preset',
            'scoringRuleVersion.tiers',
            'days.matches.squadEntries.squad.clan',
            'squadEntries.squad.clan',
        ]));
    }
}
