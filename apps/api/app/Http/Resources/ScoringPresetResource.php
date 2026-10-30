<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class ScoringPresetResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'description' => $this->description,
            'is_builtin' => $this->is_builtin,
            'versions' => $this->whenLoaded('versions', fn (): array => $this->versions->map(fn ($version): array => [
                'id' => $version->id,
                'version_number' => $version->version_number,
                'mode' => $version->mode,
                'kill_point_value' => (string) $version->kill_point_value,
                'maximum_position' => $version->maximum_position,
                'fallback_placement_points' => $version->fallback_placement_points === null ? null : (string) $version->fallback_placement_points,
                'fallback_multiplier' => $version->fallback_multiplier === null ? null : (string) $version->fallback_multiplier,
                'tiers' => $version->tiers->map(fn ($tier): array => [
                    'position_from' => $tier->position_from,
                    'position_to' => $tier->position_to,
                    'placement_points' => $tier->placement_points === null ? null : (string) $tier->placement_points,
                    'multiplier' => $tier->multiplier === null ? null : (string) $tier->multiplier,
                ])->all(),
            ])->all()),
        ];
    }
}
