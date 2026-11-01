<?php

namespace App\Http\Resources;

use App\Models\MatchResult;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin MatchResult */
final class MatchResultResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'saved_at' => $this->published_at,
            'lock_version' => $this->lock_version,
            'results' => $this->whenLoaded('squadResults', fn () => $this->squadResults->map(static fn ($result): array => [
                'squad_id' => $result->squad_id,
                'squad_name' => $result->squad_name_snapshot,
                'squad_number' => $result->squad?->squad_number,
                'squad_slug' => $result->squad?->slug,
                'clan_name' => $result->squad?->clan?->name,
                'clan_tag' => $result->squad?->clan?->tag,
                'clan_squad_count' => $result->squad?->clan?->squads?->count(),
                'participation_status' => $result->participation_status,
                'placement' => $result->placement,
                'team_kills' => $result->team_kills,
                'team_kills_override' => $result->team_kills_override,
                'kills_confirmed' => $result->kills_confirmed,
                'is_partial' => $result->participation_status === 'present' && ($result->placement === null
                    || ! $result->kills_confirmed || $result->playerResults->isEmpty()
                    || $result->playerResults->contains(fn ($player) => $player->kills === null)
                    || $result->playerResults->sum('kills') !== $result->team_kills),
                'unattributed_kills' => max(0, $result->team_kills - $result->playerResults->sum('kills')),
                'kill_points' => $result->kill_points,
                'placement_points' => $result->placement_points,
                'placement_multiplier' => $result->placement_multiplier,
                'total_points' => $result->total_points,
                'players' => $result->playerResults->map(static fn ($player): array => [
                    'player_id' => $player->player_id,
                    'ign' => $player->ign_snapshot,
                    'kills' => $player->kills,
                ])->all(),
            ])->values()->all()),
        ];
    }
}
