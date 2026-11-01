<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Http\Controllers\Controller;
use App\Http\Resources\MatchResultResource;
use App\Models\CompetitionMatch;
use Brick\Math\BigDecimal;
use Illuminate\Http\JsonResponse;

final class MatchResultsController extends Controller
{
    public function __invoke(CompetitionMatch $match): JsonResponse
    {
        $this->loadPublicResult($match);

        $result = (new MatchResultResource($match->currentResult))->resolve(request());

        return response()->json(['data' => [
            'match' => [
                'id' => $match->id,
                'event' => ['id' => $match->day->event->id, 'title' => $match->day->event->title, 'slug' => $match->day->event->slug],
                'date' => $match->day->event_date->toDateString(),
                'match_index' => $match->match_index,
                'map_code' => $match->map_code,
                'map_label' => $match->map_label,
            ],
            'scoring' => $match->rules_snapshot,
            'result' => $result,
        ]]);
    }

    public function standings(CompetitionMatch $match): JsonResponse
    {
        $this->loadPublicResult($match);
        $compare = static function ($left, $right): int {
            return BigDecimal::of($right->total_points)->compareTo($left->total_points)
                ?: ($right->team_kills <=> $left->team_kills)
                ?: (($left->placement ?? PHP_INT_MAX) <=> ($right->placement ?? PHP_INT_MAX));
        };
        $rows = $match->currentResult->squadResults->where('participation_status', 'present')->sort($compare)->values();
        $previous = null;
        $rank = 0;
        $standings = $rows->map(static function ($row, int $index) use (&$previous, &$rank, $compare): array {
            if ($previous === null || $compare($previous, $row) !== 0) {
                $rank = $index + 1;
            }
            $previous = $row;

            return [
                'rank' => $rank, 'squad_id' => $row->squad_id, 'squad_name' => $row->squad_name_snapshot,
                'squad_number' => $row->squad?->squad_number,
                'squad_slug' => $row->squad?->slug, 'clan_name' => $row->squad?->clan?->name,
                'clan_tag' => $row->squad?->clan?->tag,
                'clan_squad_count' => $row->squad?->clan?->squads?->count(),
                'placement' => $row->placement, 'team_kills' => $row->team_kills,
                'kill_points' => $row->kill_points, 'placement_points' => $row->placement_points,
                'placement_multiplier' => $row->placement_multiplier, 'total_points' => $row->total_points,
            ];
        });

        return response()->json(['data' => ['match_id' => $match->id, 'scoring' => $match->rules_snapshot, 'standings' => $standings]]);
    }

    private function loadPublicResult(CompetitionMatch $match): void
    {
        $match->load(['day.event', 'currentResult.squadResults.squad.clan.squads:id,clan_id', 'currentResult.squadResults.playerResults']);
        abort_if($match->day?->event === null, 404);
        abort_unless($match->day->event->visibility === 'public' && $match->currentResult !== null, 404);
    }
}
