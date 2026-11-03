<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ResultPermissions;
use App\Http\Controllers\Controller;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\EventSquad;
use App\Models\MatchSquad;
use App\Models\Squad;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class MatchLateEntryController extends Controller
{
    public function __invoke(Request $request, CompetitionMatch $match, ResultPermissions $permissions): JsonResponse
    {
        $match->load('day.event');
        abort_unless($permissions->canManage($request->user(), $match->day->event), 403);
        $data = $request->validate([
            'squad_id' => ['nullable', 'ulid', 'required_without:clan_id', 'prohibits:clan_id', Rule::exists('squads', 'id')],
            'clan_id' => ['nullable', 'ulid', 'required_without:squad_id', Rule::exists('clans', 'id')],
            'slot_number' => ['required', 'integer', 'min:1', 'max:25'],
        ]);
        $squadId = DB::transaction(function () use ($request, $match, $data): string {
            $event = CompetitionEvent::query()->lockForUpdate()->findOrFail($match->day->event->id);
            if (filled($data['squad_id'] ?? null)) {
                $squad = Squad::query()->findOrFail($data['squad_id']);
            } else {
                $clan = Clan::query()->lockForUpdate()->findOrFail($data['clan_id']);
                $number = ((int) $clan->squads()->max('squad_number')) + 1;
                $id = (string) Str::ulid();
                $squad = new Squad([
                    'clan_id' => $clan->id, 'name' => 'Squad '.$number, 'squad_number' => $number,
                    'slug' => 'squad-'.$number.'-'.strtolower($id), 'status' => 'active',
                    'captain_user_id' => $request->user()->id,
                ]);
                $squad->id = $id;
                $squad->save();
            }
            $taken = $event->squadEntries()->where('slot_number', $data['slot_number'])
                ->where('squad_id', '!=', $squad->id)->exists();
            if ($taken) {
                throw ValidationException::withMessages(['slot_number' => 'This slot belongs to another clan. Choose a free slot.']);
            }
            $entry = $event->squadEntries()->where('squad_id', $squad->id)->first();
            if ($entry?->slot_number !== null && (int) $entry->slot_number !== $data['slot_number']) {
                throw ValidationException::withMessages(['slot_number' => 'This clan already has slot '.$entry->slot_number.'. Use its existing slot.']);
            }
            EventSquad::query()->updateOrCreate(
                ['event_id' => $event->id, 'squad_id' => $squad->id],
                ['status' => 'active', 'slot_number' => $data['slot_number'], 'added_by' => $request->user()->id],
            );
            MatchSquad::query()->updateOrCreate(
                ['match_id' => $match->id, 'squad_id' => $squad->id], ['entry_status' => 'expected'],
            );
            $event->forceFill(['squad_capacity' => max($event->squad_capacity, $data['slot_number'])])->save();

            return $squad->id;
        });

        $sheet = app(MatchResultSheetController::class)($request, $match, $permissions);

        return response()->json(['data' => ['squad_id' => $squadId, 'sheet' => $sheet->getData(true)['data']]], 201);
    }
}
