<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Domain\Competition\BuildEventStandings;
use App\Http\Controllers\Controller;
use App\Models\CompetitionEvent;
use App\Models\Squad;
use Illuminate\Http\JsonResponse;

final class SquadHistoryController extends Controller
{
    public function __invoke(string $squad, BuildEventStandings $standings): JsonResponse
    {
        $squad = Squad::query()->where('slug', $squad)->firstOrFail();
        $events = CompetitionEvent::query()
            ->where('visibility', 'public')
            ->whereHas('squadEntries', fn ($query) => $query
                ->where('squad_id', $squad->id)
                ->where('status', 'active'))
            ->whereHas('days.matches', fn ($query) => $query->whereNotNull('current_published_revision_id'))
            ->with('days.matches.currentResult')
            ->orderByDesc('created_at')
            ->get();

        $result = $standings->forEvents($events);
        $rowsBySquad = collect($result['standings'])->keyBy(fn (array $row): string => (string) $row['squad']['id']);
        $history = $events->map(function (CompetitionEvent $event) use ($result, $rowsBySquad, $squad): ?array {
            $row = $rowsBySquad->get((string) $squad->id);
            if ($row === null || $row['matches_played'] === 0) {
                return null;
            }

            $days = $event->days;
            $matches = $days->flatMap(fn ($day) => $day->matches);

            return [
                'event' => [
                    'id' => $event->id,
                    'title' => $event->title,
                    'slug' => $event->slug,
                    'start_date' => $days->min('event_date')?->toDateString(),
                    'end_date' => $days->max('event_date')?->toDateString(),
                ],
                'rank' => $row['rank'],
                'matches_played' => $row['matches_played'],
                'total_kills' => $row['total_kills'],
                'wins' => $row['wins'],
                'total_points' => $row['total_points'],
                'uses_mixed_scoring_presets' => $result['uses_mixed_scoring_presets'],
                'scored_match_count' => $matches->filter(fn ($match) => $match->currentResult !== null)->count(),
            ];
        })->filter()->sortByDesc(fn (array $item): string => $item['event']['end_date'] ?? '')->values();

        return response()->json(['data' => $history]);
    }
}
