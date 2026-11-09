<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Domain\Competition\BuildEventStandings;
use App\Http\Controllers\Controller;
use App\Models\CompetitionSeries;
use Illuminate\Http\JsonResponse;

final class SeriesStandingsController extends Controller
{
    public function __invoke(CompetitionSeries $series, BuildEventStandings $standings): JsonResponse
    {
        $events = $series->events()
            ->where('visibility', 'public')
            ->get();

        return response()->json(['data' => [
            'series' => [
                'id' => $series->id,
                'title' => $events->first()?->title,
            ],
        ] + $standings->forEvents($events)]);
    }
}
