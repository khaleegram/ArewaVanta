<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\SaveMatchResults;
use App\Http\Controllers\Controller;
use App\Http\Requests\SaveMatchResultsRequest;
use App\Http\Resources\MatchResultResource;
use App\Models\CompetitionMatch;
use Illuminate\Http\JsonResponse;

final class MatchResultController extends Controller
{
    public function save(SaveMatchResultsRequest $request, CompetitionMatch $match, SaveMatchResults $saveResults): JsonResponse
    {
        return (new MatchResultResource($saveResults->handle(
            $request->user(),
            $match,
            $request->validated('results'),
            $request->exists('expected_lock_version'),
            $request->validated('expected_lock_version'),
            $request->exists('expected_scoring_version_id'),
            $request->validated('expected_scoring_version_id'),
            $request->boolean('patch_mode'),
        )))->response()->setStatusCode(200);
    }
}
