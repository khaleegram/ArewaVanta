<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ChangeMatchScoring;
use App\Http\Controllers\Controller;
use App\Http\Requests\ChangeMatchScoringRequest;
use App\Models\CompetitionMatch;
use Illuminate\Http\JsonResponse;

final class MatchScoringController extends Controller
{
    public function __invoke(ChangeMatchScoringRequest $request, CompetitionMatch $match, ChangeMatchScoring $changeMatchScoring): JsonResponse
    {
        $match = $changeMatchScoring->handle($request->user(), $match, $request->validated('scoring_rule_version_id'));

        return response()->json(['data' => [
            'id' => $match->id,
            'is_scoring_override' => $match->scoring_rule_version_id !== $match->day->event->scoring_rule_version_id,
            'scoring' => $match->rules_snapshot,
        ]]);
    }
}
