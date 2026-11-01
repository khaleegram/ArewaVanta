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
            'squadEntries.squad.clan.squads:id,clan_id',
            'currentResult.squadResults.squad.clan.squads:id,clan_id',
            'currentResult.squadResults.playerResults.player',
        ]);
        $event = $match->day->event;
        abort_unless($permissions->canManage($request->user(), $event), 403);

        $eventSlots = $event->squadEntries()->where('status', 'active')->pluck('slot_number', 'squad_id');
        $rosters = $event->track_player_kills ? $eligibleRoster->forMatch($match) : collect();
        $legacyResult = $match->resultRecords()->whereIn('status', ['draft', 'revision_draft', 'submitted'])
            ->where('revision_number', '>', $match->currentResult?->revision_number ?? 0)
            ->with(['squadResults.squad.clan.squads:id,clan_id', 'squadResults.playerResults'])->reorder()->orderByDesc('revision_number')->first();
        $editableResult = $legacyResult ?? $match->currentResult;

        return response()->json(['data' => [
            'event' => [
                'id' => $event->id,
                'title' => $event->title,
                'slug' => $event->slug,
                'timezone' => $event->timezone,
                'squad_size' => $event->squad_size,
                'track_player_kills' => $event->track_player_kills,
                'maximum_position' => $event->maximum_position,
            ],
            'match' => [
                'id' => $match->id,
                'date' => $match->day->event_date->toDateString(),
                'match_index' => $match->match_index,
                'map_label' => $match->map_label,
                'scoring' => $match->rules_snapshot,
            ],
            'squads' => $match->squadEntries->where('entry_status', 'expected')->sortBy(fn ($entry) => $eventSlots->get($entry->squad_id, 999))->map(static function ($entry) use ($rosters, $editableResult, $eventSlots): array {
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
                    'squad_number' => $entry->squad->squad_number,
                    'tag' => $entry->squad->tag,
                    'clan' => $entry->squad->clan->name,
                    'clan_tag' => $entry->squad->clan->tag,
                    'clan_squad_count' => $entry->squad->clan->squads->count(),
                    'slot_number' => $eventSlots->get($entry->squad_id) === null ? null : (int) $eventSlots->get($entry->squad_id),
                    'eligible_players' => $players->values(),
                ];
            })->values(),
            'result' => $editableResult === null
                ? null
                : (new MatchResultResource($editableResult))->resolve($request),
        ]]);
    }
}
