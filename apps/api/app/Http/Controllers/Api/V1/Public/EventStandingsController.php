<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Domain\Competition\BuildEventStandings;
use App\Http\Controllers\Controller;
use App\Models\CompetitionEvent;
use Illuminate\Http\JsonResponse;

final class EventStandingsController extends Controller
{
    public function __invoke(string $event, BuildEventStandings $buildEventStandings): JsonResponse
    {
        $competitionEvent = CompetitionEvent::query()
            ->where('slug', $event)
            ->where('visibility', 'public')
            ->firstOrFail();

        return response()->json(['data' => $buildEventStandings->handle($competitionEvent)]);
    }
}
