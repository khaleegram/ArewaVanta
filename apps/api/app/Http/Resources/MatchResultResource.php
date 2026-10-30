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
            'results' => $this->whenLoaded('squadResults', fn () => $this->squadResults->map(static fn ($result): array => [
                'squad_id' => $result->squad_id,
                'squad_name' => $result->squad_name_snapshot,
                'squad_slug' => $result->squad?->slug,
                'clan_name' => $result->squad?->clan?->name,
                'participation_status' => $result->participation_status,
                'placement' => $result->placement,
                'team_kills' => $result->team_kills,
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
