<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Domain\Competition\BuildEventStandings;
use App\Http\Controllers\Controller;
use App\Models\Season;
use Illuminate\Http\JsonResponse;

final class SeasonStandingsController extends Controller
{
    public function __invoke(Season $season, BuildEventStandings $standings): JsonResponse
    {
        return response()->json(['data' => $standings->forSeason($season)]);
    }
}
