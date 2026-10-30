<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Http\Controllers\Controller;
use App\Models\CompetitionEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class EventController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:50'],
        ]);

        $events = CompetitionEvent::query()
            ->with(['season', 'days.matches.currentResult'])
            ->withCount(['squadEntries as squad_count' => fn ($query) => $query->where('status', 'active')])
            ->where('visibility', 'public')
            ->orderByDesc('created_at')
            ->paginate($filters['per_page'] ?? 20);

        return response()->json([
            'data' => $events->getCollection()->map(fn (CompetitionEvent $event): array => $this->summary($event))->values(),
            'meta' => [
                'current_page' => $events->currentPage(),
                'last_page' => $events->lastPage(),
                'per_page' => $events->perPage(),
                'total' => $events->total(),
            ],
        ]);
    }

    public function show(string $event): JsonResponse
    {
        $competitionEvent = CompetitionEvent::query()
            ->where('slug', $event)
            ->where('visibility', 'public')
            ->with([
                'season',
                'scoringRuleVersion.preset',
                'squadEntries.squad.clan',
                'days.matches.squadEntries.squad.clan',
                'days.matches.currentResult.squadResults.squad.clan',
            ])
            ->withCount(['squadEntries as squad_count' => fn ($query) => $query->where('status', 'active')])
            ->firstOrFail();

        return response()->json(['data' => [
            ...$this->summary($competitionEvent),
            'description' => $competitionEvent->description,
            'maximum_position' => $competitionEvent->maximum_position,
            'squad_size' => $competitionEvent->squad_size,
            'season' => $competitionEvent->season === null ? null : [
                'id' => $competitionEvent->season->id,
                'name' => $competitionEvent->season->name,
            ],
            'default_scoring' => [
                'preset_name' => $competitionEvent->scoringRuleVersion?->preset?->name,
                'mode' => $competitionEvent->scoringRuleVersion?->mode,
            ],
            'squads' => $competitionEvent->squadEntries->where('status', 'active')->map(static fn ($entry): array => [
                'id' => $entry->squad->id,
                'name' => $entry->squad->name,
                'slug' => $entry->squad->slug,
                'tag' => $entry->squad->tag,
                'clan' => ['name' => $entry->squad->clan->name, 'tag' => $entry->squad->clan->tag],
            ])->values(),
            'days' => $competitionEvent->days->map(static fn ($day): array => [
                'id' => $day->id,
                'date' => $day->event_date->toDateString(),
                'label' => $day->label,
                'sort_order' => $day->sort_order,
                'matches' => $day->matches->map(static function ($match) use ($competitionEvent): array {
                    $revision = $match->currentResult;

                    return [
                        'id' => $match->id,
                        'match_index' => $match->match_index,
                        'map_code' => $match->map_code,
                        'map_label' => $match->map_label,
                        'has_results' => $revision !== null,
                        'is_scoring_override' => $match->scoring_rule_version_id !== $competitionEvent->scoring_rule_version_id,
                        'scoring' => $match->rules_snapshot,
                        'results' => $revision?->squadResults->map(static fn ($result): array => [
                            'squad_id' => $result->squad_id,
                            'squad_name' => $result->squad_name_snapshot,
                            'squad_slug' => $result->squad?->slug,
                            'clan_name' => $result->squad?->clan?->name,
                            'participation_status' => $result->participation_status,
                            'placement' => $result->placement,
                            'team_kills' => $result->team_kills,
                            'total_points' => $result->total_points,
                        ])->values(),
                    ];
                }),
            ])->values(),
        ]]);
    }

    /** @return array<string, mixed> */
    private function summary(CompetitionEvent $event): array
    {
        $days = $event->days->sortBy('sort_order');
        $matches = $days->flatMap(static fn ($day) => $day->matches);

        return [
            'id' => $event->id,
            'title' => $event->title,
            'competition_type' => $event->competition_type,
            'squad_count' => $event->squad_count,
            'slug' => $event->slug,
            'timezone' => $event->timezone,
            'season' => $event->season === null ? null : ['id' => $event->season->id, 'name' => $event->season->name],
            'start_date' => $days->first()?->event_date->toDateString(),
            'end_date' => $days->last()?->event_date->toDateString(),
            'match_count' => $matches->count(),
            'scored_match_count' => $matches->filter(static fn ($match): bool => $match->currentResult !== null)->count(),
        ];
    }
}
