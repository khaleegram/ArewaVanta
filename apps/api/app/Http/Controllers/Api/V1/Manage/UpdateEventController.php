<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ResultPermissions;
use App\Domain\Competition\UpdateCompetitionEvent;
use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateCompetitionEventRequest;
use App\Http\Resources\CompetitionEventResource;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class UpdateEventController extends Controller
{
    public function __invoke(UpdateCompetitionEventRequest $request, CompetitionEvent $event, UpdateCompetitionEvent $updateEvent): CompetitionEventResource
    {
        return new CompetitionEventResource($updateEvent->handle($request->user(), $event, $request->validated()));
    }

    public function destroy(Request $request, CompetitionEvent $event, ResultPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManage($request->user(), $event), 403);
        DB::transaction(function () use ($event): void {
            CompetitionEvent::query()->lockForUpdate()->findOrFail($event->id);
            CompetitionMatch::query()->whereHas('day', fn ($query) => $query->where('event_id', $event->id))->delete();
            $event->days()->delete();
            $event->delete();
        });

        return response()->json(status: 204);
    }
}
