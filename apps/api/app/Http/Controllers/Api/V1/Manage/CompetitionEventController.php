<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\CreateCompetitionEvent;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreCompetitionEventRequest;
use App\Http\Resources\CompetitionEventResource;
use Illuminate\Http\JsonResponse;

final class CompetitionEventController extends Controller
{
    public function __invoke(StoreCompetitionEventRequest $request, CreateCompetitionEvent $createCompetitionEvent): JsonResponse
    {
        $event = $createCompetitionEvent->handle($request->user(), $request->validated());

        return (new CompetitionEventResource($event))->response()->setStatusCode(201);
    }
}
