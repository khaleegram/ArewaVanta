<?php

namespace App\Domain\Competition;

use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\Season;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;

final class BuildEventStandings
{
    /** @return array{event: array<string, string>, uses_mixed_scoring_presets: bool, standings: list<array<string, mixed>>} */
    public function handle(CompetitionEvent $event): array
    {
        return ['event' => ['id' => $event->id, 'title' => $event->title, 'slug' => $event->slug]]
            + $this->calculate(new Collection([$event]));
    }

    public function forSeason(Season $season, bool $publicOnly = true): array
    {
        $events = $season->events()->when($publicOnly, fn ($query) => $query->where('visibility', 'public'))->get();

        return ['season' => ['id' => $season->id, 'name' => $season->name, 'slug' => $season->slug]]
            + $this->calculate($events);
    }

    /** @param Collection<int, CompetitionEvent> $events @return array<string, mixed> */
    public function forEvents(Collection $events): array
    {
        return $this->calculate($events);
    }

    /** @param Collection<int, CompetitionEvent> $events @return array<string, mixed> */
    private function calculate(Collection $events): array
    {
        $events->loadMissing(['squadEntries.squad.clan.squads:id,clan_id']);
        $matches = CompetitionMatch::query()
            ->whereHas('day', static fn ($query) => $query->whereIn('event_id', $events->pluck('id')))
            ->whereNotNull('current_published_revision_id')
            ->with([
                'day',
                'currentResult.squadResults.squad.clan.squads:id,clan_id',
            ])
            ->orderBy('event_day_id')
            ->orderBy('match_index')
            ->get();

        $aggregates = [];
        foreach ($events->flatMap(fn ($event) => $event->squadEntries->where('status', 'active'))->unique('squad_id') as $entry) {
            $squad = $entry->squad;
            $aggregates[$squad->id] = [
                'squad' => $squad,
                'total_points' => BigDecimal::zero(),
                'total_kills' => 0,
                'matches_played' => 0,
                'wins' => 0,
                'additive_placement_points' => BigDecimal::zero(),
                'multiplier_scored_points' => BigDecimal::zero(),
                'multiplier_matches' => 0,
                'has_multiplier_score' => false,
                'results' => [],
                'shared_placements' => [],
                'tie_break_position_sum' => null,
            ];
        }

        $presetNames = [];
        $placementsByMatch = [];
        foreach ($matches as $match) {
            $revision = $match->currentResult;
            if ($revision === null) {
                continue;
            }
            $presetName = $match->rules_snapshot['preset_name'] ?? 'Custom scoring';
            $presetNames[$match->rules_snapshot['preset_id'] ?? $presetName] = true;
            $matchPlacements = [];

            foreach ($revision->squadResults as $result) {
                if (! isset($aggregates[$result->squad_id]) || $result->participation_status !== 'present') {
                    continue;
                }

                $aggregate = $aggregates[$result->squad_id];
                $aggregate['total_points'] = $aggregate['total_points']->plus($result->total_points);
                $aggregate['total_kills'] += $result->team_kills;
                $aggregate['matches_played']++;
                if ($result->placement === 1) {
                    $aggregate['wins']++;
                }
                if ($result->placement_points !== null) {
                    $aggregate['additive_placement_points'] = $aggregate['additive_placement_points']->plus($result->placement_points);
                }
                if ($result->placement_multiplier !== null) {
                    $aggregate['multiplier_scored_points'] = $aggregate['multiplier_scored_points']->plus($result->total_points);
                    $aggregate['multiplier_matches']++;
                    $aggregate['has_multiplier_score'] = true;
                }

                $aggregate['results'][] = [
                    'match_id' => $match->id,
                    'event_date' => $match->day->event_date->toDateString(),
                    'match_index' => $match->match_index,
                    'map_label' => $match->map_label,
                    'scoring_preset' => $presetName,
                    'placement' => $result->placement,
                    'team_kills' => $result->team_kills,
                    'total_points' => (string) BigDecimal::of($result->total_points)->strippedOfTrailingZeros(),
                ];
                $matchPlacements[$result->squad_id] = $result->placement;
                $aggregates[$result->squad_id] = $aggregate;
            }
            $placementsByMatch[$match->id] = $matchPlacements;
        }

        $rows = array_values(array_map(function (array $aggregate): array {
            $minimumScale = $aggregate['has_multiplier_score'] ? 1 : 0;

            return [
                'squad' => [
                    'id' => $aggregate['squad']->id,
                    'name' => $aggregate['squad']->name,
                    'squad_number' => $aggregate['squad']->squad_number,
                    'slug' => $aggregate['squad']->slug,
                    'tag' => $aggregate['squad']->tag,
                    'clan' => [
                        'name' => $aggregate['squad']->clan->name,
                        'tag' => $aggregate['squad']->clan->tag,
                        'squad_count' => $aggregate['squad']->clan->squads->count(),
                    ],
                ],
                'matches_played' => $aggregate['matches_played'],
                'total_kills' => $aggregate['total_kills'],
                'wins' => $aggregate['wins'],
                'total_points' => $this->formatPoints($aggregate['total_points'], $minimumScale),
                'additive_placement_points' => $this->formatPoints($aggregate['additive_placement_points']),
                'multiplier_scored_points' => $this->formatPoints($aggregate['multiplier_scored_points'], 1),
                'multiplier_matches' => $aggregate['multiplier_matches'],
                'match_results' => $aggregate['results'],
                'tie_break_position_sum' => null,
                '_total_points' => $aggregate['total_points'],
                '_has_multiplier_score' => $aggregate['has_multiplier_score'],
                '_shared_placements' => [],
            ];
        }, $aggregates));

        usort($rows, fn (array $left, array $right): int => $this->comparePrimary($left, $right));
        foreach ($this->primaryTieGroups($rows) as [$start, $end]) {
            if ($end - $start < 2) {
                continue;
            }

            $groupIds = [];
            for ($index = $start; $index < $end; $index++) {
                $groupIds[] = $rows[$index]['squad']['id'];
            }

            $sums = array_fill_keys($groupIds, 0);
            $sharedMatchCounts = array_fill_keys($groupIds, 0);
            foreach ($placementsByMatch as $placements) {
                $shared = array_intersect_key($placements, array_fill_keys($groupIds, true));
                // Compare a tied group only on games every squad in that group played.
                if (count($shared) !== count($groupIds)) {
                    continue;
                }
                foreach ($shared as $squadId => $placement) {
                    $sums[$squadId] += $placement;
                    $sharedMatchCounts[$squadId]++;
                }
            }

            $hasComparableResultsForEverySquad = count(array_filter($sharedMatchCounts, static fn (int $count): bool => $count > 0)) === count($groupIds);
            for ($index = $start; $index < $end; $index++) {
                $squadId = $rows[$index]['squad']['id'];
                $rows[$index]['_shared_placements'] = $hasComparableResultsForEverySquad ? $sums[$squadId] : null;
                $rows[$index]['tie_break_position_sum'] = $hasComparableResultsForEverySquad ? $sums[$squadId] : null;
            }

            if ($hasComparableResultsForEverySquad) {
                $slice = array_slice($rows, $start, $end - $start);
                usort($slice, static fn (array $left, array $right): int => $left['_shared_placements'] <=> $right['_shared_placements']);
                array_splice($rows, $start, $end - $start, $slice);
            }
        }

        $previous = null;
        $rank = 0;
        foreach ($rows as $index => &$row) {
            if ($previous === null || $this->compareFinal($previous, $row) !== 0) {
                $rank = $index + 1;
            }
            $row['rank'] = $rank;
            $previous = $row;
            unset($row['_total_points'], $row['_has_multiplier_score'], $row['_shared_placements']);
        }
        unset($row);

        return [
            'uses_mixed_scoring_presets' => count($presetNames) > 1,
            'standings' => $rows,
        ];
    }

    /** @param array<string, mixed> $left @param array<string, mixed> $right */
    private function comparePrimary(array $left, array $right): int
    {
        if (! $left['_total_points']->isEqualTo($right['_total_points'])) {
            return $left['_total_points']->isGreaterThan($right['_total_points']) ? -1 : 1;
        }

        return ($right['total_kills'] <=> $left['total_kills'])
            ?: ($right['wins'] <=> $left['wins']);
    }

    /** @param array<string, mixed> $left @param array<string, mixed> $right */
    private function compareFinal(array $left, array $right): int
    {
        $primary = $this->comparePrimary($left, $right);
        if ($primary !== 0) {
            return $primary;
        }

        if ($left['tie_break_position_sum'] !== null && $right['tie_break_position_sum'] !== null) {
            return $left['tie_break_position_sum'] <=> $right['tie_break_position_sum'];
        }

        return 0;
    }

    /** @param list<array<string, mixed>> $rows @return list<array{int, int}> */
    private function primaryTieGroups(array $rows): array
    {
        $groups = [];
        $start = 0;
        for ($index = 1, $count = count($rows); $index <= $count; $index++) {
            if ($index === $count || $this->comparePrimary($rows[$start], $rows[$index]) !== 0) {
                $groups[] = [$start, $index];
                $start = $index;
            }
        }

        return $groups;
    }

    private function formatPoints(BigDecimal $points, int $minimumScale = 0): string
    {
        $normalized = $points->strippedOfTrailingZeros();

        if ($normalized->isZero() || $normalized->getScale() >= $minimumScale) {
            return (string) $normalized;
        }

        return (string) $normalized->toScale($minimumScale);
    }
}
