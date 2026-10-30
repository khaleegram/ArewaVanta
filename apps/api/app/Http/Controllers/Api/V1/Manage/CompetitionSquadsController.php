<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\SyncCompetitionSquads;
use App\Http\Controllers\Controller;
use App\Http\Requests\SyncCompetitionSquadsRequest;
use App\Http\Resources\CompetitionEventResource;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use Illuminate\Http\JsonResponse;

final class CompetitionSquadsController extends Controller
{
    public function event(SyncCompetitionSquadsRequest $request, CompetitionEvent $event, SyncCompetitionSquads $sync): CompetitionEventResource
    {
        return new CompetitionEventResource($sync->forEvent($request->user(), $event, $request->validated('squad_ids')));
    }

    public function match(SyncCompetitionSquadsRequest $request, CompetitionMatch $match, SyncCompetitionSquads $sync): JsonResponse
    {
        $match = $sync->forMatch($request->user(), $match, $request->validated('squad_ids'));

        return response()->json(['data' => [
            'match_id' => $match->id,
            'squads' => $match->squadEntries->where('entry_status', 'expected')->map(static fn ($entry): array => [
                'id' => $entry->squad->id,
                'name' => $entry->squad->name,
                'tag' => $entry->squad->tag,
                'clan' => $entry->squad->clan->name,
            ])->values(),
        ]]);
    }
}
