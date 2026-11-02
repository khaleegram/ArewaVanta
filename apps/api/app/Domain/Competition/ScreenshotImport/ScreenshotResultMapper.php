<?php

namespace App\Domain\Competition\ScreenshotImport;

use App\Domain\Competition\PlayerNameSearch;
use App\Models\Player;

final class ScreenshotResultMapper
{
    /**
     * @param  array{teams: list<array<string, mixed>>, warnings: list<string>, model: string}  $extraction
     * @param  array<string, mixed>  $sheet
     * @return array<string, mixed>
     */
    public function map(array $extraction, array $sheet): array
    {
        $squads = array_values((array) ($sheet['squads'] ?? []));
        $slotSquads = [];
        $playerIndex = [];
        $allPlayers = [];
        $knownPlayerIds = [];

        foreach ($squads as $squad) {
            if (! is_array($squad) || ! isset($squad['id'])) {
                continue;
            }
            if ($squad['slot_number'] !== null) {
                $slotSquads[(int) $squad['slot_number']] = $squad;
            }

            $eligible = [];
            foreach ([...($squad['roster_players'] ?? []), ...($squad['eligible_players'] ?? [])] as $player) {
                if (! is_array($player) || ! isset($player['id'])) {
                    continue;
                }
                $eligible[$player['id']] = $player;
            }

            foreach ($eligible as $player) {
                $key = PlayerNameSearch::key((string) ($player['ign'] ?? ''));
                if ($key === '') {
                    continue;
                }
                $candidate = [
                    'player_id' => $player['id'],
                    'ign' => $player['ign'],
                    'squad_id' => $squad['id'],
                    'squad_name' => $squad['name'],
                    'clan' => $squad['clan'],
                    'clan_tag' => $squad['clan_tag'],
                    'slot_number' => $squad['slot_number'],
                ];
                $playerIndex[$squad['id']][$key][] = $candidate;
                $allPlayers[$key][] = $candidate;
                $knownPlayerIds[$candidate['player_id']] = true;
            }
        }

        // A player can exist in the app but not in this event's result sheet.
        // Surface them as guest candidates instead of suggesting a duplicate profile.
        foreach (Player::query()->where('status', 'active')->with('clan:id,name,tag')->get(['id', 'current_ign', 'clan_id']) as $player) {
            if (isset($knownPlayerIds[$player->id])) {
                continue;
            }
            $key = PlayerNameSearch::key($player->current_ign);
            if ($key === '') {
                continue;
            }
            $allPlayers[$key][] = [
                'player_id' => $player->id,
                'ign' => $player->current_ign,
                'squad_id' => null,
                'squad_name' => null,
                'clan' => $player->clan?->name,
                'clan_tag' => $player->clan?->tag,
                'slot_number' => null,
            ];
        }

        $usedPlayers = [];
        $mappedTeams = [];
        $warnings = array_values((array) ($extraction['warnings'] ?? []));

        foreach ((array) ($extraction['teams'] ?? []) as $team) {
            if (! is_array($team)) {
                continue;
            }

            $label = trim((string) ($team['team_label'] ?? 'Team'));
            $number = is_int($team['team_number'] ?? null) ? $team['team_number'] : null;
            $placement = is_int($team['placement'] ?? null) ? $team['placement'] : null;
            $teamKills = is_int($team['team_kills'] ?? null) ? $team['team_kills'] : null;
            $extractedPlayers = array_values((array) ($team['players'] ?? []));

            $slotSquad = $number !== null ? ($slotSquads[$number] ?? null) : null;
            $best = $this->bestRosterMatch($extractedPlayers, $playerIndex, $squads);
            $matchedSquad = $slotSquad;
            $suggestedSquad = null;
            $status = 'unassigned';

            if ($matchedSquad !== null) {
                $slotOverlap = $this->overlap($extractedPlayers, $playerIndex[$matchedSquad['id']] ?? []);
                if ($best !== null && $best['squad']['id'] !== $matchedSquad['id'] && $best['score'] > $slotOverlap && $slotOverlap === 0) {
                    $suggestedSquad = $best['squad'];
                    $status = 'roster_mismatch';
                    $warnings[] = $label.' is on slot '.$number.', but its players look more like '.$this->squadName($best['squad']).'. Confirm the mapping before applying.';
                } else {
                    $status = 'matched';
                }
            } elseif ($best !== null) {
                $matchedSquad = $best['squad'];
                $status = 'roster_matched';
                $warnings[] = $label.' has no slot '.$number.' in this game, but its players match '.$this->squadName($best['squad']).' by roster. Confirm before applying.';
            } elseif ($number !== null) {
                $warnings[] = $label.' is not assigned to slot '.$number.' in this game.';
            } else {
                $warnings[] = $label.' has no readable team number and could not be matched to a squad.';
            }

            $players = [];
            foreach ($extractedPlayers as $player) {
                if (! is_array($player)) {
                    continue;
                }
                $name = trim((string) ($player['name'] ?? ''));
                if ($name === '') {
                    continue;
                }
                $key = PlayerNameSearch::key($name);
                $kills = is_int($player['kills'] ?? null) ? $player['kills'] : null;
                $resolved = $this->resolvePlayer($key, $name, $matchedSquad, $playerIndex, $allPlayers);
                if ($resolved['player_id'] !== null && isset($usedPlayers[$resolved['player_id']])) {
                    $resolved['status'] = 'duplicate';
                    $resolved['duplicate_of'] = $usedPlayers[$resolved['player_id']];
                    $warnings[] = $name.' appears in more than one team. Resolve before applying.';
                } elseif ($resolved['player_id'] !== null) {
                    $usedPlayers[$resolved['player_id']] = $label;
                }
                $players[] = [
                    'name' => $name,
                    'kills' => $kills,
                    'kills_options' => $player['kills_options'] ?? [],
                    ...$resolved,
                ];
            }

            $knownKills = array_sum(array_map(
                static fn (array $player): int => is_int($player['kills'] ?? null) ? $player['kills'] : 0,
                $players,
            ));

            if ($placement === null) {
                $warnings[] = $label.' has no readable placement.';
            }
            if ($number !== null && ($number < 1 || $number > 25)) {
                $warnings[] = $label.' has team number '.$number.', which is outside the 1–25 slot range.';
            }

            $mappedTeams[] = [
                'team_label' => $label,
                'team_number' => $number,
                'placement' => $placement,
                'team_kills' => $teamKills,
                'placement_options' => $team['placement_options'] ?? [],
                'team_kills_options' => $team['team_kills_options'] ?? [],
                'known_kills' => $knownKills,
                'status' => $status,
                'squad' => $matchedSquad === null ? null : $this->squadSummary($matchedSquad),
                'suggested_squad' => $suggestedSquad === null ? null : $this->squadSummary($suggestedSquad),
                'players' => $players,
            ];
        }

        return [
            'teams' => $mappedTeams,
            'warnings' => array_values(array_unique($warnings)),
            'model' => $extraction['model'] ?? null,
            'summary' => [
                'teams' => count($mappedTeams),
                'matched_teams' => count(array_filter($mappedTeams, static fn (array $team): bool => in_array($team['status'], ['matched', 'roster_matched'], true))),
                'unresolved_teams' => count(array_filter($mappedTeams, static fn (array $team): bool => in_array($team['status'], ['unassigned', 'roster_mismatch'], true))),
                'players' => array_sum(array_map(static fn (array $team): int => count($team['players']), $mappedTeams)),
                'matched_players' => $this->countPlayerStatus($mappedTeams, 'matched'),
                'guest_candidates' => $this->countPlayerStatus($mappedTeams, 'other_squad'),
                'new_candidates' => $this->countPlayerStatus($mappedTeams, 'new'),
                'ambiguous_players' => $this->countPlayerStatus($mappedTeams, 'ambiguous'),
                'duplicate_players' => $this->countPlayerStatus($mappedTeams, 'duplicate'),
            ],
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $players
     * @param  array<string, array<string, list<array<string, mixed>>>>  $playerIndex
     * @param  list<array<string, mixed>>  $squads
     * @return array{squad: array<string, mixed>, score: int}|null
     */
    private function bestRosterMatch(array $players, array $playerIndex, array $squads): ?array
    {
        $keys = $this->keys($players);
        if ($keys === []) {
            return null;
        }
        $minimum = count($keys) <= 2 ? 1 : 2;
        $best = null;
        $tied = false;
        foreach ($squads as $squad) {
            $score = $this->overlap($players, $playerIndex[$squad['id']] ?? []);
            if ($score >= $minimum && ($best === null || $score > $best['score'])) {
                $best = ['squad' => $squad, 'score' => $score];
                $tied = false;
            } elseif ($best !== null && $score === $best['score']) {
                $tied = true;
            }
        }

        return $tied ? null : $best;
    }

    /**
     * @param  array<string, list<array<string, mixed>>>  $squadPlayers
     * @param  array<string, list<array<string, mixed>>>  $allPlayers
     * @return array<string, mixed>
     */
    private function resolvePlayer(string $key, string $name, ?array $squad, array $squadPlayers, array $allPlayers): array
    {
        $sameSquad = $squad === null ? [] : ($squadPlayers[$squad['id']][$key] ?? []);
        $sameSquad = $this->uniqueCandidates($sameSquad);
        if (count($sameSquad) === 1) {
            return $this->matchedPlayer($sameSquad[0], 'matched');
        }
        if (count($sameSquad) > 1) {
            return ['status' => 'ambiguous', 'player_id' => null, 'ign' => null, 'candidates' => $sameSquad];
        }

        $global = $this->uniqueCandidates($allPlayers[$key] ?? []);
        if (count($global) === 1) {
            return $this->matchedPlayer($global[0], 'other_squad');
        }
        if (count($global) > 1) {
            return ['status' => 'ambiguous', 'player_id' => null, 'ign' => null, 'candidates' => $global];
        }

        return ['status' => 'new', 'player_id' => null, 'ign' => $name, 'candidates' => []];
    }

    /** @param list<array<string, mixed>> $candidates @return list<array<string, mixed>> */
    private function uniqueCandidates(array $candidates): array
    {
        $unique = [];
        foreach ($candidates as $candidate) {
            $unique[$candidate['player_id']] = $candidate;
        }

        return array_values($unique);
    }

    /** @param array<string, mixed> $candidate @return array<string, mixed> */
    private function matchedPlayer(array $candidate, string $status): array
    {
        return [
            'status' => $status,
            'player_id' => $candidate['player_id'],
            'ign' => $candidate['ign'],
            'squad_id' => $candidate['squad_id'],
            'squad_name' => $candidate['squad_name'],
            'clan' => $candidate['clan'],
            'clan_tag' => $candidate['clan_tag'],
            'slot_number' => $candidate['slot_number'],
            'candidates' => [],
        ];
    }

    /** @param list<array<string, mixed>> $players @return list<string> */
    private function keys(array $players): array
    {
        $keys = [];
        foreach ($players as $player) {
            $key = PlayerNameSearch::key((string) ($player['name'] ?? ''));
            if ($key !== '') {
                $keys[$key] = true;
            }
        }

        return array_keys($keys);
    }

    /** @param list<array<string, mixed>> $players @param array<string, list<array<string, mixed>>> $index */
    private function overlap(array $players, array $index): int
    {
        return count(array_intersect($this->keys($players), array_keys($index)));
    }

    /** @param array<string, mixed> $squad @return array<string, mixed> */
    private function squadSummary(array $squad): array
    {
        return [
            'id' => $squad['id'],
            'name' => $squad['name'],
            'squad_number' => $squad['squad_number'] ?? null,
            'clan' => $squad['clan'],
            'clan_id' => $squad['clan_id'],
            'clan_tag' => $squad['clan_tag'],
            'clan_squad_count' => $squad['clan_squad_count'] ?? null,
            'slot_number' => $squad['slot_number'],
        ];
    }

    /** @param array<string, mixed> $squad */
    private function squadName(array $squad): string
    {
        return trim(($squad['clan_tag'] ?? '').' · '.($squad['name'] ?? ''), ' ·');
    }

    /** @param list<array<string, mixed>> $teams */
    private function countPlayerStatus(array $teams, string $status): int
    {
        return array_sum(array_map(
            static fn (array $team): int => count(array_filter($team['players'], static fn (array $player): bool => $player['status'] === $status)),
            $teams,
        ));
    }
}
