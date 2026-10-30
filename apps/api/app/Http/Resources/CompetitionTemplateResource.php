<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class CompetitionTemplateResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'description' => $this->description,
            'timezone' => $this->timezone,
            'squad_size' => $this->squad_size,
            'maximum_position' => $this->maximum_position,
            'is_system' => $this->is_system,
            'default_scoring' => $this->whenLoaded('defaultRuleVersion', fn (): ?array => $this->defaultRuleVersion === null ? null : [
                'id' => $this->defaultRuleVersion->id,
                'preset_name' => $this->defaultRuleVersion->preset->name,
                'mode' => $this->defaultRuleVersion->mode,
                'version_number' => $this->defaultRuleVersion->version_number,
            ]),
            'days' => $this->whenLoaded('days', fn (): array => $this->days->map(fn ($day): array => [
                'label' => $day->label,
                'sort_order' => $day->sort_order,
                'games' => $day->games->map(fn ($game): array => [
                    'game_number' => $game->game_number,
                    'map_code' => $game->map_code,
                    'map_label' => $game->map_label,
                    'rule_version_override_id' => $game->rule_version_override_id,
                    'override_preset_name' => $game->ruleVersionOverride?->preset?->name,
                ])->all(),
            ])->all()),
        ];
    }
}
