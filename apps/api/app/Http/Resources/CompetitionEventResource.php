<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class CompetitionEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'description' => $this->description,
            'competition_type' => $this->competition_type,
            'slug' => $this->slug,
            'visibility' => $this->visibility,
            'timezone' => $this->timezone,
            'squad_size' => $this->squad_size,
            'maximum_position' => $this->maximum_position,
            'season' => $this->whenLoaded('season', fn (): ?array => $this->season === null ? null : [
                'id' => $this->season->id,
                'name' => $this->season->name,
            ]),
            'scoring' => [
                'preset_name' => $this->scoringRuleVersion?->preset?->name,
                'version_number' => $this->scoringRuleVersion?->version_number,
                'mode' => $this->scoringRuleVersion?->mode,
                'rules' => $this->scoringRuleVersion?->toScoringRules()->toArray(),
            ],
            'days' => $this->whenLoaded('days', fn (): array => $this->days->map(fn ($day): array => [
                'id' => $day->id,
                'date' => $day->event_date->toDateString(),
                'label' => $day->label,
                'sort_order' => $day->sort_order,
                'matches' => $day->matches->map(fn ($match): array => [
                    'id' => $match->id,
                    'match_index' => $match->match_index,
                    'map_code' => $match->map_code,
                    'map_label' => $match->map_label,
                    'has_results' => $match->current_published_revision_id !== null,
                    'is_scoring_override' => $match->scoring_rule_version_id !== $this->scoring_rule_version_id,
                    'scoring' => $match->rules_snapshot,
                    'expected_squads' => $match->squadEntries->where('entry_status', 'expected')->map(fn ($entry): array => [
                        'id' => $entry->squad->id,
                        'name' => $entry->squad->name,
                        'tag' => $entry->squad->tag,
                        'clan' => $entry->squad->clan->name,
                    ])->values()->all(),
                ])->all(),
            ])->values()->all()),
            'squads' => $this->whenLoaded('squadEntries', fn (): array => $this->squadEntries->where('status', 'active')->map(fn ($entry): array => [
                'id' => $entry->squad->id,
                'name' => $entry->squad->name,
                'tag' => $entry->squad->tag,
                'clan' => $entry->squad->clan->name,
                'seed' => $entry->seed,
            ])->values()->all()),
        ];
    }
}
