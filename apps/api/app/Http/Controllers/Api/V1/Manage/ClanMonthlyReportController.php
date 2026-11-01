<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\OrganizationPermissions;
use App\Http\Controllers\Controller;
use App\Models\Clan;
use App\Models\CompetitionMatch;
use App\Models\MatchSquadResult;
use Brick\Math\BigDecimal;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

final class ClanMonthlyReportController extends Controller
{
    public function __invoke(Request $request, Clan $clan, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageClan($request->user(), $clan), 403);
        $data = $request->validate(['month' => ['sometimes', 'date_format:Y-m']]);
        $month = CarbonImmutable::createFromFormat('!Y-m', $data['month'] ?? now('Africa/Lagos')->format('Y-m'), 'Africa/Lagos');
        $previous = $month->subMonth();
        $rows = $this->rows($clan, $month);
        $previousRows = $this->rows($clan, $previous);
        $clan->load('squads');
        $squads = $clan->squads->map(function ($squad) use ($rows, $previousRows): array {
            $results = $rows->where('squad_id', $squad->id)->values();

            return [
                'id' => $squad->id, 'name' => $squad->name, 'number' => $squad->squad_number, 'slug' => $squad->slug,
                'summary' => $this->summary($results),
                'previous' => $this->summary($previousRows->where('squad_id', $squad->id)),
                'players' => $this->players($results),
                'matches' => $results->map(fn ($row): array => $this->matchRow($row))->all(),
            ];
        })->sortByDesc(fn ($squad) => (float) $squad['summary']['points'])->values();
        $timeline = $rows->groupBy(fn ($row): string => $row->matchResult->match->day->event_date->toDateString())
            ->map(fn ($day, $date): array => ['date' => $date, 'summary' => $this->summary($day)])->values();
        $events = $rows->groupBy(fn ($row): string => $row->matchResult->match->day->event_id)->map(function ($results): array {
            $event = $results->first()->matchResult->match->day->event;

            return ['id' => $event->id, 'title' => $event->title, 'slug' => $event->slug, 'summary' => $this->summary($results)];
        })->values();

        return response()->json(['data' => [
            'clan' => ['id' => $clan->id, 'name' => $clan->name, 'tag' => $clan->tag, 'slug' => $clan->slug],
            'month' => $month->format('Y-m'), 'month_label' => $month->format('F Y'),
            'previous_month_label' => $previous->format('F Y'), 'timezone' => 'Africa/Lagos',
            'generated_at' => now()->toIso8601String(),
            'summary' => $this->summary($rows), 'previous' => $this->summary($previousRows),
            'squads' => $squads, 'players' => $this->players($rows), 'timeline' => $timeline, 'competitions' => $events,
            'notes' => [
                'Only the latest saved result for each game is counted. Corrections update this report automatically.',
                'Match dates determine the report month. Clan totals count each squad’s appearance separately.',
                'Player statistics use named match participants, including substitutes; they do not change permanent clan membership.',
                'Blank player kills stay unknown. Unattributed team kills count for squads, never for a guessed player.',
                'Points follow each match’s saved scoring rules; totals across different presets may not be directly comparable.',
            ],
        ]])->header('Cache-Control', 'private, no-store');
    }

    private function rows(Clan $clan, CarbonImmutable $month): Collection
    {
        $revisions = CompetitionMatch::query()->select('current_published_revision_id')
            ->whereNotNull('current_published_revision_id')
            ->whereHas('day', fn ($query) => $query->whereBetween('event_date', [$month->toDateString(), $month->endOfMonth()->toDateString()])->whereHas('event'));

        return MatchSquadResult::query()->whereHas('squad', fn ($query) => $query->where('clan_id', $clan->id))
            ->whereIn('revision_id', $revisions)->whereHas('matchResult', fn ($query) => $query->where('status', 'published'))
            ->with(['matchResult.match.day.event', 'playerResults.player'])->get()
            ->sortBy(fn ($row): string => $row->matchResult->match->day->event_date->toDateString().sprintf('%03d', $row->matchResult->match->match_index))->values();
    }

    private function summary(Collection $rows): array
    {
        $played = $rows->where('participation_status', 'present');
        $placements = $played->pluck('placement')->filter(fn ($position) => $position !== null);
        $players = $played->flatMap->playerResults;
        $kills = (int) $played->sum('team_kills');
        $attributed = (int) $players->sum('kills');
        $partial = $played->filter(fn ($row): bool => $row->placement === null || ! $row->kills_confirmed
            || $row->playerResults->isEmpty() || $row->playerResults->contains(fn ($player) => $player->kills === null)
            || (int) $row->playerResults->sum('kills') !== $row->team_kills)->count();

        return [
            'appearances' => $played->count(), 'games' => $played->pluck('match_id')->unique()->count(),
            'match_days' => $played->map(fn ($row): string => $row->matchResult->match->day->event_date->toDateString())->unique()->count(),
            'absences' => $rows->where('participation_status', 'absent')->count(),
            'wins' => $placements->filter(fn ($position): bool => $position === 1)->count(),
            'top_three' => $placements->filter(fn ($position): bool => $position <= 3)->count(),
            'kills' => $kills, 'attributed_kills' => $attributed, 'unattributed_kills' => max(0, $kills - $attributed),
            'points' => (string) $played->reduce(fn (BigDecimal $sum, $row): BigDecimal => $sum->plus($row->total_points), BigDecimal::zero())->strippedOfTrailingZeros(),
            'average_placement' => $placements->isEmpty() ? null : round($placements->avg(), 2),
            'average_kills' => $played->isEmpty() ? null : round($kills / $played->count(), 2),
            'win_rate' => $played->isEmpty() ? null : round($placements->filter(fn ($position): bool => $position === 1)->count() / $played->count() * 100, 1),
            'best_placement' => $placements->min(), 'best_game_kills' => $played->isEmpty() ? null : (int) $played->max('team_kills'),
            'players' => $players->pluck('player_id')->unique()->count(),
            'partial_results' => $partial, 'missing_placements' => $played->count() - $placements->count(),
            'unknown_player_scores' => $players->whereNull('kills')->count(),
        ];
    }

    private function players(Collection $rows): array
    {
        $scores = [];
        foreach ($rows->where('participation_status', 'present') as $row) {
            foreach ($row->playerResults as $player) {
                $id = $player->player_id;
                $scores[$id] ??= ['id' => $id, 'ign' => $player->player?->current_ign ?? $player->ign_snapshot,
                    'appearances' => 0, 'recorded_games' => 0, 'kills' => 0, 'best_game' => null, 'wins' => 0, 'squad_ids' => []];
                $scores[$id]['appearances']++;
                $scores[$id]['wins'] += $row->placement === 1 ? 1 : 0;
                $scores[$id]['squad_ids'][] = $row->squad_id;
                if ($player->kills !== null) {
                    $scores[$id]['recorded_games']++;
                    $scores[$id]['kills'] += $player->kills;
                    $scores[$id]['best_game'] = max($scores[$id]['best_game'] ?? 0, $player->kills);
                }
            }
        }

        return collect($scores)->map(function ($player): array {
            $player['squad_ids'] = array_values(array_unique($player['squad_ids']));
            $player['average_kills'] = $player['recorded_games'] ? round($player['kills'] / $player['recorded_games'], 2) : null;

            return $player;
        })->sortByDesc('kills')->values()->all();
    }

    private function matchRow(MatchSquadResult $row): array
    {
        $match = $row->matchResult->match;

        return [
            'id' => $match->id, 'date' => $match->day->event_date->toDateString(), 'game' => $match->match_index,
            'map' => $match->map_label, 'event' => $match->day->event->title, 'event_id' => $match->day->event_id,
            'status' => $row->participation_status, 'placement' => $row->placement,
            'kills' => $row->team_kills, 'kills_confirmed' => $row->kills_confirmed,
            'points' => (string) BigDecimal::of($row->total_points)->strippedOfTrailingZeros(),
            'players' => $row->playerResults->map(fn ($player): array => [
                'id' => $player->player_id, 'ign' => $player->ign_snapshot, 'kills' => $player->kills,
            ])->all(),
        ];
    }
}
