<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ManageWeeklyScrims;
use App\Http\Controllers\Controller;
use App\Http\Resources\CompetitionEventResource;
use App\Models\CompetitionEvent;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class EventRecurrenceController extends Controller
{
    public function __invoke(Request $request, CompetitionEvent $event, ManageWeeklyScrims $manager): CompetitionEventResource
    {
        $data = $request->validate([
            'action' => ['required', Rule::in(['start', 'pause', 'resume', 'end', 'skip', 'restore'])],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        return new CompetitionEventResource($manager->update($request->user(), $event, $data['action'], $data['reason'] ?? null));
    }
}
