<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\EligibleMatchRoster;
use App\Domain\Competition\ResultPermissions;
use App\Http\Controllers\Controller;
use App\Http\Resources\MatchResultResource;
use App\Models\CompetitionMatch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MatchResultSheetController extends Controller
{
    public function __invoke(Request $request, CompetitionMatch $match, ResultPermissions $permissions, EligibleMatchRoster $eligibleRoster): JsonResponse
    {
        $match->load([
            'day.event',
            'squadEntries.squad.clan',
            'currentResult.squadResults.squad.clan',
            'currentResult.squadResults.playerResults.player',
        ]);
        $event = $match->day->event;
        abort_unless($permissions->canManage($request->user(), $event), 403);

        $rosters = $eligibleRoster->forMatch($match);
        $legacyResult = $match->resultRecords()->whereIn('status', ['draft', 'revision_draft', 'submitted'])
            ->where('revision_number', '>', $match->currentResult?->revision_number ?? 0)
            ->with(['squadResults.squad.clan', 'squadResults.playerResults'])->reorder()->orderByDesc('revision_number')->first();
        $editableResult = $legacyResult ?? $match->currentResult;

        return response()->json(['data' => [
            'event' => [
                'id' => $event->id,
                'title' => $event->title,
                'slug' => $event->slug,
                'timezone' => $event->timezone,
                'squad_size' => $event->squad_size,
                'maximum_position' => $event->maximum_position,
            ],
            'match' => [
                'id' => $match->id,
                'date' => $match->day->event_date->toDateString(),
                'match_index' => $match->match_index,
                'map_label' => $match->map_label,
                'scoring' => $match->rules_snapshot,
            ],
            'squads' => $match->squadEntries->where('entry_status', 'expected')->map(static function ($entry) use ($rosters, $editableResult): array {
                $players = $rosters->get($entry->squad_id, collect())->map(static fn ($membership): array => [
                    'id' => $membership->player->id,
                    'ign' => $membership->player->current_ign,
                ]);
                $previousResult = $editableResult?->squadResults->firstWhere('squad_id', $entry->squad_id);
                foreach ($previousResult?->playerResults ?? [] as $previousPlayer) {
                    $players->put($previousPlayer->player_id, ['id' => $previousPlayer->player_id, 'ign' => $previousPlayer->ign_snapshot]);
                }

                return [
                    'id' => $entry->squad->id,
                    'name' => $entry->squad->name,
                    'tag' => $entry->squad->tag,
                    'clan' => $entry->squad->clan->name,
                    'eligible_players' => $players->values(),
                ];
            })->values(),
            'result' => $editableResult === null
                ? null
                : (new MatchResultResource($editableResult))->resolve($request),
        ]]);
    }
}
