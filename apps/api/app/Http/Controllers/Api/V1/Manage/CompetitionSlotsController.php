<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ManageCompetitionSlots;
use App\Http\Controllers\Controller;
use App\Http\Requests\SaveCompetitionSlotsRequest;
use App\Models\CompetitionEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class CompetitionSlotsController extends Controller
{
    public function show(Request $request, CompetitionEvent $event, ManageCompetitionSlots $slots): JsonResponse
    {
        return response()->json(['data' => $slots->show($request->user(), $event)])->header('Cache-Control', 'private, no-store');
    }

    public function update(SaveCompetitionSlotsRequest $request, CompetitionEvent $event, ManageCompetitionSlots $slots): JsonResponse
    {
        return response()->json(['data' => $slots->save($request->user(), $event, $request->validated('slots'), $request->validated('expected_version'))])->header('Cache-Control', 'private, no-store');
    }
}
