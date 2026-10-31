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
            'skipped_at' => $this->skipped_at?->toIso8601String(),
            'skip_reason' => $this->skip_reason,
            'recurrence' => $this->series_id === null ? null : $this->recurrenceData(),
            'visibility' => $this->visibility,
            'timezone' => $this->timezone,
            'squad_size' => $this->squad_size,
            'squad_capacity' => $this->squad_capacity,
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
                        'squad_number' => $entry->squad->squad_number,
                        'tag' => $entry->squad->tag,
                        'clan' => $entry->squad->clan->name,
                        'clan_tag' => $entry->squad->clan->tag,
                        'clan_squad_count' => $entry->squad->clan->squads->count(),
                        'slot_number' => $this->squadEntries->firstWhere('squad_id', $entry->squad_id)?->slot_number,
                    ])->values()->all(),
                ])->all(),
            ])->values()->all()),
            'squads' => $this->whenLoaded('squadEntries', fn (): array => $this->squadEntries->where('status', 'active')->sortBy('slot_number')->map(fn ($entry): array => [
                'id' => $entry->squad->id,
                'name' => $entry->squad->name,
                'squad_number' => $entry->squad->squad_number,
                'tag' => $entry->squad->tag,
                'clan' => $entry->squad->clan->name,
                'clan_tag' => $entry->squad->clan->tag,
                'clan_squad_count' => $entry->squad->clan->squads->count(),
                'slot_number' => $entry->slot_number,
                'seed' => $entry->seed,
            ])->values()->all()),
        ];
    }

    private function recurrenceData(): array
    {
        $this->resource->loadMissing('series.events.days');
        $series = $this->series;

        return [
            'id' => $series->id,
            'state' => $series->state(),
            'next_week_date' => $series->state() === 'active' ? $series->next_week_date->toDateString() : null,
            'weeks' => $series->events->sortByDesc('series_week_date')->map(fn ($week): array => [
                'id' => $week->id, 'slug' => $week->slug,
                'start_date' => $week->days->min('event_date')?->toDateString(),
                'end_date' => $week->days->max('event_date')?->toDateString(),
                'skipped_at' => $week->skipped_at?->toIso8601String(),
                'skip_reason' => $week->skip_reason,
            ])->values()->all(),
        ];
    }
}
