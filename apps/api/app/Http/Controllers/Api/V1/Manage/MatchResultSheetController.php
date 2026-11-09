<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ResultPermissions;
use App\Http\Controllers\Controller;
use App\Http\Resources\MatchResultResource;
use App\Models\CompetitionMatch;
use App\Models\Player;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MatchResultSheetController extends Controller
{
    public function __invoke(Request $request, CompetitionMatch $match, ResultPermissions $permissions): JsonResponse
    {
        $match->load([
            'day.event',
            'squadEntries.squad.clan.squads:id,clan_id',
            'currentResult.squadResults.squad.clan.squads:id,clan_id',
            'currentResult.squadResults.playerResults.player.clan:id,tag',
        ]);
        $event = $match->day->event;
        abort_unless($permissions->canManage($request->user(), $event), 403);

        $eventSlots = $event->squadEntries()->where('status', 'active')->pluck('slot_number', 'squad_id');
        $clanPlayers = Player::query()->where('status', 'active')
            ->whereIn('clan_id', $match->squadEntries->map(fn ($entry) => $entry->squad->clan_id)->unique())
            ->orderBy('current_ign')->get(['id', 'clan_id', 'current_ign'])->groupBy('clan_id');
        $legacyResult = $match->resultRecords()->whereIn('status', ['draft', 'revision_draft', 'submitted'])
            ->where('revision_number', '>', $match->currentResult?->revision_number ?? 0)
            ->with(['squadResults.squad.clan.squads:id,clan_id', 'squadResults.playerResults.player.clan:id,tag'])->reorder()->orderByDesc('revision_number')->first();
        $editableResult = $legacyResult ?? $match->currentResult;

        return response()->json(['data' => [
            'event' => [
                'id' => $event->id,
                'title' => $event->title,
                'slug' => $event->slug,
                'timezone' => $event->timezone,
                'squad_size' => $event->squad_size,
                'track_player_kills' => true,
                'maximum_position' => $event->maximum_position,
            ],
            'event_slots' => $eventSlots->map(fn ($slot, $squadId): array => ['squad_id' => $squadId, 'slot_number' => $slot === null ? null : (int) $slot])->values(),
            'match' => [
                'id' => $match->id,
                'date' => $match->day->event_date->toDateString(),
                'match_index' => $match->match_index,
                'map_label' => $match->map_label,
                'scoring' => $match->rules_snapshot,
            ],
            'squads' => $match->squadEntries->where('entry_status', 'expected')->sortBy(fn ($entry) => $eventSlots->get($entry->squad_id, 999))->map(static function ($entry) use ($clanPlayers, $editableResult, $eventSlots): array {
                $players = $clanPlayers->get($entry->squad->clan_id, collect())->mapWithKeys(static fn ($player): array => [
                    $player->id => [
                        'id' => $player->id,
                        'ign' => $player->current_ign,
                        'clan_tag' => $entry->squad->clan->tag,
                    ],
                ]);
                $rosterPlayers = [];
                $previousResult = $editableResult?->squadResults->firstWhere('squad_id', $entry->squad_id);
                foreach ($previousResult?->playerResults ?? [] as $previousPlayer) {
                    $players->put($previousPlayer->player_id, [
                        'id' => $previousPlayer->player_id,
                        'ign' => $previousPlayer->ign_snapshot,
                        'clan_tag' => $previousPlayer->player?->clan?->tag,
                    ]);
                }

                return [
                    'id' => $entry->squad->id,
                    'name' => $entry->squad->name,
                    'squad_number' => $entry->squad->squad_number,
                    'tag' => $entry->squad->tag,
                    'clan' => $entry->squad->clan->name,
                    'clan_id' => $entry->squad->clan_id,
                    'clan_tag' => $entry->squad->clan->tag,
                    'clan_tags' => $entry->squad->clan->tagList(),
                    'clan_squad_count' => $entry->squad->clan->squads->count(),
                    'slot_number' => $entry->source_team_number ?? ($eventSlots->get($entry->squad_id) === null ? null : (int) $eventSlots->get($entry->squad_id)),
                    'source_team_number' => $entry->source_team_number,
                    'roster_players' => $rosterPlayers,
                    'eligible_players' => $players->values(),
                ];
            })->values(),
            'result' => $editableResult === null
                ? null
                : (new MatchResultResource($editableResult))->resolve($request),
        ]]);
    }
}
