<?php

namespace App\Domain\Competition\ScreenshotImport;

use App\Domain\Competition\ClanTag;
use App\Domain\Competition\PlayerNameSearch;
use App\Models\Clan;
use App\Models\Player;
use App\Models\PlayerAlias;

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
        $allCandidates = [];
        $knownPlayerIds = [];
        $allTags = [];
        $tagOwners = [];
        $aliasesByPlayer = PlayerAlias::query()
            ->whereHas('player', static fn ($query) => $query->where('status', 'active'))
            ->get(['player_id', 'alias'])
            ->groupBy('player_id')
            ->map(static fn ($aliases): array => $aliases->pluck('alias')->all())
            ->all();
        foreach (Clan::query()->get(['id', 'name', 'tag', 'tags']) as $clan) {
            foreach ($clan->tagList() as $tag) {
                $allTags[] = $tag;
                $tagOwners[PlayerNameSearch::key($tag)] = [
                    'id' => $clan->id,
                    'name' => $clan->name,
                    'tag' => $tag,
                ];
            }
        }

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
                $clanTags = $squad['clan_tags'] ?? ($squad['clan_tag'] ? [$squad['clan_tag']] : []);
                $cleanIgn = ClanTag::strip((string) ($player['ign'] ?? ''), $clanTags);
                $key = PlayerNameSearch::key($cleanIgn);
                if ($key === '') {
                    continue;
                }
                $candidate = [
                    'player_id' => $player['id'],
                    'ign' => $cleanIgn,
                    'squad_id' => $squad['id'],
                    'squad_name' => $squad['name'],
                    'clan' => $squad['clan'],
                    'clan_id' => $squad['clan_id'],
                    'clan_tag' => $squad['clan_tag'],
                    'clan_tags' => $squad['clan_tags'] ?? ($squad['clan_tag'] ? [$squad['clan_tag']] : []),
                    'slot_number' => $squad['slot_number'],
                    'aliases' => $aliasesByPlayer[$player['id']] ?? [],
                ];
                $playerIndex[$squad['id']][$key][] = $candidate;
                $allPlayers[$key][] = $candidate;
                $allCandidates[$candidate['player_id']] ??= $candidate;
                $knownPlayerIds[$candidate['player_id']] = true;
            }
        }

        // A player can exist in the app but not in this event's result sheet.
        // Surface them as guest candidates instead of suggesting a duplicate profile.
        foreach (Player::query()->where('status', 'active')->with('clan:id,name,tag,tags')->get(['id', 'current_ign', 'clan_id']) as $player) {
            if (isset($knownPlayerIds[$player->id])) {
                continue;
            }
            $clanTags = $player->clan?->tagList() ?? [];
            $cleanIgn = ClanTag::strip($player->current_ign, $clanTags);
            $key = PlayerNameSearch::key($cleanIgn);
            if ($key === '') {
                continue;
            }
            $candidate = [
                'player_id' => $player->id,
                'ign' => $cleanIgn,
                'squad_id' => null,
                'squad_name' => null,
                'clan' => $player->clan?->name,
                'clan_id' => $player->clan_id,
                'clan_tag' => $player->clan?->tag,
                'clan_tags' => $clanTags,
                'slot_number' => null,
                'aliases' => $aliasesByPlayer[$player->id] ?? [],
            ];
            $allPlayers[$key][] = $candidate;
            $allCandidates[$player->id] ??= $candidate;
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

            $teamClanId = $this->teamClanVote($extractedPlayers, $allTags, $tagOwners);
            $explicitTeamNumber = $number !== null && preg_match('/^\s*TEAM\s*\d{1,2}\b/i', $label) === 1;
            $slotSquad = $explicitTeamNumber ? ($slotSquads[$number] ?? null) : null;
            $clanSquads = $teamClanId === null
                ? []
                : array_values(array_filter($squads, static fn (array $squad): bool => ($squad['clan_id'] ?? null) === $teamClanId));
            $clanNumberSquads = array_values(array_filter(
                $clanSquads,
                static fn (array $squad): bool => $number !== null && (int) ($squad['squad_number'] ?? 0) === $number,
            ));
            $best = $this->bestRosterMatch($extractedPlayers, $playerIndex, $squads, $allTags);
            if ($best !== null && $teamClanId !== null && ($best['squad']['clan_id'] ?? null) !== $teamClanId) {
                $best = null;
            }

            $matchedSquad = count($clanNumberSquads) === 1 ? $clanNumberSquads[0] : null;
            $matchedBy = $matchedSquad === null ? null : 'clan_squad';
            if ($matchedSquad === null && $slotSquad !== null) {
                $matchedSquad = $slotSquad;
                $matchedBy = 'slot';
            }
            if ($matchedSquad === null && $teamClanId !== null && count($clanSquads) === 1) {
                $matchedSquad = $clanSquads[0];
                $matchedBy = 'clan';
            }
            if ($matchedSquad === null && $best !== null) {
                $matchedSquad = $best['squad'];
                $matchedBy = 'roster';
            }
            $suggestedSquad = null;
            $status = 'unassigned';

            if ($matchedSquad !== null) {
                $slotOverlap = $this->overlap($extractedPlayers, $playerIndex[$matchedSquad['id']] ?? [], $allTags);
                if ($matchedBy === 'slot' && $best !== null && $best['squad']['id'] !== $matchedSquad['id'] && $best['score'] > $slotOverlap && $slotOverlap === 0) {
                    $suggestedSquad = $best['squad'];
                    $status = 'roster_mismatch';
                    $warnings[] = $label.' is on slot '.$number.', but its players look more like '.$this->squadName($best['squad']).'. Confirm the mapping before applying.';
                } elseif ($matchedBy === 'roster') {
                    $status = 'roster_matched';
                    $warnings[] = $label.' has no explicit TEAM number but its players match '.$this->squadName($matchedSquad).' by roster. Confirm before applying.';
                } else {
                    $status = 'matched';
                }
            } elseif ($teamClanId !== null && count($clanSquads) > 1) {
                $warnings[] = $label.' looks like '.$this->clanName($teamClanId, $tagOwners).' but several squads belong to that clan. Choose the correct squad.';
            } elseif ($number !== null && $explicitTeamNumber) {
                $warnings[] = $label.' is not assigned to slot '.$number.' in this game.';
            } else {
                $warnings[] = $label.' has no readable TEAM number and could not be matched to a squad by clan tag or roster.';
            }

            $players = [];
            foreach ($extractedPlayers as $player) {
                if (! is_array($player)) {
                    continue;
                }
                $rawName = trim((string) ($player['name'] ?? ''));
                if ($rawName === '') {
                    continue;
                }
                $split = ClanTag::split($rawName, $allTags);
                $lookupName = $split['name'];
                $tagOwner = $split['tag'] === null
                    ? null
                    : ($tagOwners[PlayerNameSearch::key($split['tag'])] ?? null);
                $key = PlayerNameSearch::key($lookupName);
                $kills = is_int($player['kills'] ?? null) ? $player['kills'] : null;
                $resolved = $this->resolvePlayer($key, $lookupName, $matchedSquad, $playerIndex, $allPlayers, $allCandidates, $tagOwner);
                if (($resolved['tag_conflict'] ?? false) && $split['tag'] !== null) {
                    $warnings[] = $rawName.' reads as '.$split['tag'].', but '.$label.' is mapped to '.$this->squadName($matchedSquad).'. The team slot keeps the new profile in '.$this->squadName($matchedSquad).'.';
                }
                if ($resolved['player_id'] !== null && isset($usedPlayers[$resolved['player_id']])) {
                    $resolved['status'] = 'duplicate';
                    $resolved['duplicate_of'] = $usedPlayers[$resolved['player_id']];
                    $warnings[] = $rawName.' appears in more than one team. Resolve before applying.';
                } elseif ($resolved['player_id'] !== null) {
                    $usedPlayers[$resolved['player_id']] = $label;
                }
                $players[] = [
                    'name' => $rawName,
                    'tag' => $resolved['clan_tag'] ?? $split['tag'],
                    'kills' => $kills,
                    'kills_options' => $player['kills_options'] ?? [],
                    ...$resolved,
                    'clan_id' => $resolved['clan_id'] ?? $tagOwner['id'] ?? null,
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
     * Use the clan tags visible in the player names to identify the team's clan.
     * This is stronger evidence than a generic board label such as "Squad 1".
     *
     * @param  list<array<string, mixed>>  $players
     * @param  list<string>  $allTags
     * @param  array<string, array<string, string>>  $tagOwners
     */
    private function teamClanVote(array $players, array $allTags, array $tagOwners): ?string
    {
        $votes = [];
        foreach ($players as $player) {
            if (! is_array($player)) {
                continue;
            }
            $split = ClanTag::split((string) ($player['name'] ?? ''), $allTags);
            if ($split['tag'] === null) {
                continue;
            }
            $owner = $tagOwners[PlayerNameSearch::key($split['tag'])] ?? null;
            if ($owner !== null) {
                $votes[$owner['id']] = ($votes[$owner['id']] ?? 0) + 1;
            }
        }

        if ($votes === []) {
            return null;
        }

        arsort($votes);
        $top = array_keys($votes)[0] ?? null;
        if ($top === null) {
            return null;
        }
        $counts = array_values($votes);
        if (count($counts) > 1 && $counts[0] === $counts[1]) {
            return null;
        }

        return $top;
    }

    /** @param array<string, array<string, string>> $tagOwners */
    private function clanName(string $clanId, array $tagOwners): string
    {
        foreach ($tagOwners as $owner) {
            if (($owner['id'] ?? null) === $clanId) {
                return (string) ($owner['name'] ?? 'that clan');
            }
        }

        return 'that clan';
    }

    /**
     * @param  list<array<string, mixed>>  $players
     * @param  array<string, array<string, list<array<string, mixed>>>>  $playerIndex
     * @param  list<array<string, mixed>>  $squads
     * @return array{squad: array<string, mixed>, score: int}|null
     */
    private function bestRosterMatch(array $players, array $playerIndex, array $squads, array $allTags): ?array
    {
        $keys = $this->keys($players, $allTags);
        if ($keys === []) {
            return null;
        }
        $minimum = count($keys) <= 2 ? 1 : 2;
        $best = null;
        $tied = false;
        foreach ($squads as $squad) {
            $score = $this->overlap($players, $playerIndex[$squad['id']] ?? [], $allTags);
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
    private function resolvePlayer(string $key, string $name, ?array $squad, array $squadPlayers, array $allPlayers, array $allCandidates, ?array $tagOwner): array
    {
        $tagClanId = $tagOwner['id'] ?? null;
        $sameSquad = $squad === null ? [] : ($squadPlayers[$squad['id']][$key] ?? []);
        if ($tagClanId !== null && ($squad['clan_id'] ?? null) !== $tagClanId) {
            $sameSquad = [];
        }
        $sameSquad = $this->uniqueCandidates($sameSquad);
        if (count($sameSquad) === 1) {
            return $this->matchedPlayer($sameSquad[0], 'matched');
        }
        if (count($sameSquad) > 1) {
            return ['status' => 'ambiguous', 'player_id' => null, 'ign' => null, 'clan_id' => $tagClanId, 'candidates' => $sameSquad];
        }

        $global = $this->uniqueCandidates($allPlayers[$key] ?? []);
        if ($tagClanId !== null) {
            $global = array_values(array_filter(
                $global,
                static fn (array $candidate): bool => ($candidate['clan_id'] ?? null) === $tagClanId,
            ));
        }
        if (count($global) === 1) {
            return $this->matchedPlayer($global[0], 'other_squad');
        }
        if (count($global) > 1) {
            return ['status' => 'ambiguous', 'player_id' => null, 'ign' => null, 'clan_id' => $tagClanId, 'candidates' => $global];
        }

        $similar = $this->similarCandidates($name, $allCandidates, $tagClanId, $squad);
        if ($similar !== []) {
            $best = $similar[0];
            return [
                'status' => $best['match_score'] >= 86 ? 'suggested' : 'ambiguous',
                'player_id' => null,
                'ign' => null,
                'clan_id' => $tagClanId,
                'candidates' => $similar,
            ];
        }

        // The mapped team slot is authoritative for a new player unless the
        // name carries a clearly different, known clan tag (a real guest).
        // OCR often reads NE as NF; a one-character tag misread must not
        // create a profile in the wrong clan when the team is unambiguous.
        $teamClanId = $squad['clan_id'] ?? null;
        $tagConflictsWithTeam = $tagClanId !== null
            && $teamClanId !== null
            && $tagClanId !== $teamClanId;
        $tagLooksMisread = $tagConflictsWithTeam
            && $this->tagsLookMisread($tagOwner, $squad);
        $useTeamClan = $teamClanId !== null
            && ($tagClanId === null || $tagClanId === $teamClanId || $tagLooksMisread);
        $clanId = $useTeamClan ? $teamClanId : $tagClanId;

        return [
            'status' => 'new',
            'player_id' => null,
            'ign' => $name,
            'clan_id' => $clanId,
            'clan' => $useTeamClan ? $squad['clan'] : ($tagOwner['name'] ?? null),
            'clan_tag' => $useTeamClan ? $squad['clan_tag'] : ($tagOwner['tag'] ?? null),
            'tag_conflict' => $tagLooksMisread,
            'candidates' => [],
        ];
    }

    /**
     * OCR commonly swaps one character in a short clan tag. Only treat a
     * conflicting tag as a misread when the tags share their first letter,
     * are the same length and are one edit apart; a genuinely different
     * guest tag (GC on a KC team) is kept.
     *
     * @param  array<string, mixed>|null  $tagOwner
     * @param  array<string, mixed>  $squad
     */
    private function tagsLookMisread(?array $tagOwner, array $squad): bool
    {
        $left = PlayerNameSearch::key((string) ($tagOwner['tag'] ?? ''));
        $right = PlayerNameSearch::key((string) ($squad['clan_tag'] ?? ''));

        return $left !== ''
            && $right !== ''
            && $left[0] === $right[0]
            && strlen($left) === strlen($right)
            && strlen($left) <= 5
            && levenshtein($left, $right) === 1;
    }

    /**
     * Surface likely existing profiles instead of silently creating a near-duplicate.
     *
     * @param  array<string, array<string, mixed>>  $allCandidates
     * @return list<array<string, mixed>>
     */
    private function similarCandidates(string $name, array $allCandidates, ?string $tagClanId, ?array $squad): array
    {
        $matches = [];
        foreach ($allCandidates as $candidate) {
            $names = [(string) ($candidate['ign'] ?? ''), ...($candidate['aliases'] ?? [])];
            $score = max(array_map(
                static fn (string $alias): float => PlayerNameSearch::similarity($name, $alias),
                $names,
            ));
            $sameClan = $tagClanId !== null && ($candidate['clan_id'] ?? null) === $tagClanId;
            $sameSquad = $squad !== null && ($candidate['squad_id'] ?? null) === $squad['id'];
            if ($sameClan) {
                $score += 0.08;
            } elseif ($sameSquad) {
                $score += 0.04;
            }
            $score = min(0.99, $score);
            $threshold = $sameClan || $sameSquad ? 0.62 : 0.70;
            if ($score < $threshold) {
                continue;
            }
            $matches[$candidate['player_id']] = [
                ...$candidate,
                'match_score' => (int) round($score * 100),
                'match_reason' => $sameClan
                    ? 'Similar name in the same clan'
                    : ($sameSquad ? 'Similar name in this squad' : 'Similar registered name'),
            ];
        }

        usort($matches, static fn (array $left, array $right): int => $right['match_score'] <=> $left['match_score']);

        return array_slice(array_values($matches), 0, 5);
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
            'clan_id' => $candidate['clan_id'] ?? null,
            'clan_tag' => $candidate['clan_tag'],
            'clan_tags' => $candidate['clan_tags'] ?? [],
            'slot_number' => $candidate['slot_number'],
            'match_score' => 100,
            'match_reason' => 'Exact registered name',
            'candidates' => [],
        ];
    }

    /** @param list<array<string, mixed>> $players @return list<string> */
    private function keys(array $players, array $allTags): array
    {
        $keys = [];
        foreach ($players as $player) {
            $name = ClanTag::split((string) ($player['name'] ?? ''), $allTags)['name'];
            $key = PlayerNameSearch::key($name);
            if ($key !== '') {
                $keys[$key] = true;
            }
        }

        return array_keys($keys);
    }

    /** @param list<array<string, mixed>> $players @param array<string, list<array<string, mixed>>> $index */
    private function overlap(array $players, array $index, array $allTags): int
    {
        return count(array_intersect($this->keys($players, $allTags), array_keys($index)));
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
            'clan_tags' => $squad['clan_tags'] ?? ($squad['clan_tag'] ? [$squad['clan_tag']] : []),
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
