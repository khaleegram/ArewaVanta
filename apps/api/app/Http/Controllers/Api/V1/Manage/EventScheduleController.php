<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\UpdateEventSchedule;
use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateEventScheduleRequest;
use App\Http\Resources\CompetitionEventResource;
use App\Models\CompetitionEvent;

final class EventScheduleController extends Controller
{
    public function __invoke(UpdateEventScheduleRequest $request, CompetitionEvent $event, UpdateEventSchedule $updateSchedule): CompetitionEventResource
    {
        return new CompetitionEventResource($updateSchedule->handle($request->user(), $event, $request->validated('days')));
    }
}
