<?php

namespace App\Domain\Competition\Assistant;

use App\Domain\Competition\ClanTag;
use App\Domain\Competition\PlayerIdentity;
use App\Domain\Competition\PlayerNameSearch;
use App\Models\Clan;
use App\Models\Player;

final class AssistantPlayerResolver
{
    private array $profiles = [];

    private array $tags = [];

    private array $tagClans = [];

    private array $prefixClans = [];

    private array $resolved = [];

    private ?PlayerIdentity $identity = null;

    public function load(): void
    {
        $this->profiles = $this->tags = $this->tagClans = $this->prefixClans = $this->resolved = [];
        $this->identity = null;
        foreach (Clan::query()->get(['id', 'tag', 'tags']) as $clan) {
            foreach ($clan->tagList() as $tag) {
                $this->tags[] = $tag;
                $this->tagClans[PlayerNameSearch::key($tag)] = $clan->id;
                $prefix = $this->prefixKey($tag);
                if ($prefix !== '') {
                    $this->prefixClans[$prefix] = $clan->id;
                }
            }
        }
        foreach (Player::query()->with('aliases')->orderBy('id')->get() as $player) {
            $names = [$player->current_ign, ...$player->aliases->pluck('alias')->all()];
            $names = array_unique([...$names, ...array_map(fn ($name): string => $this->split($name)['name'], $names)]);
            $this->profiles[] = ['id' => $player->id, 'clan_id' => $player->clan_id, 'ign' => $player->current_ign, 'status' => $player->status, 'names' => $names];
        }
    }

    /** @return array{player_id?: string, ign: string, clan_id: ?string, source_clan_id: ?string, create_player?: bool, unresolved?: string} */
    public function resolve(string $literal, bool $create): array
    {
        $cacheKey = ($create ? 'create:' : 'find:').$literal;
        if (isset($this->resolved[$cacheKey])) {
            return $this->resolved[$cacheKey];
        }
        $split = $this->split($literal);
        $name = $split['name'];
        $clan = $split['clan_id'];
        $key = $this->nameKey($name);
        $ranked = [];
        foreach ($this->profiles as $profile) {
            $exact = false;
            $score = 0.0;
            foreach ($profile['names'] as $candidate) {
                $exact = $exact || $this->nameKey($candidate) === $key || $this->nameKey($candidate) === $this->nameKey($literal);
                $score = max($score, PlayerNameSearch::similarity($this->fold($candidate), $this->fold($name)));
            }
            if ($exact || $score >= .78) {
                $ranked[] = [...$profile, 'exact' => $exact, 'score' => $exact ? 1.0 : $score];
            }
        }
        usort($ranked, fn ($a, $b): int => $b['score'] <=> $a['score']);
        $exact = array_values(array_filter($ranked, fn ($p): bool => $p['exact']));
        if (count($exact) > 1 && $clan !== null) {
            $sameClan = array_values(array_filter($exact, fn ($p): bool => $p['clan_id'] === $clan));
            if (count($sameClan) === 1) {
                $exact = $sameClan;
            }
        }
        if (count($exact) > 1) {
            $active = array_values(array_filter($exact, fn ($p): bool => $p['status'] === 'active'));
            if (count($active) === 1) {
                $exact = $active;
            }
        }
        $match = count($exact) === 1 ? $exact[0] : null;
        $threshold = $clan !== null && ($ranked[0]['clan_id'] ?? null) === $clan ? .90 : .96;
        if ($match === null && $exact === [] && strlen($key) >= 5 && ($ranked[0]['score'] ?? 0) >= $threshold
            && ($ranked[0]['score'] - ($ranked[1]['score'] ?? 0)) >= .08) {
            $match = $ranked[0];
        }
        if ($match !== null) {
            return $this->resolved[$cacheKey] = ['player_id' => $match['id'], 'ign' => $match['ign'], 'clan_id' => $match['clan_id'], 'source_clan_id' => $clan];
        }
        $base = ['ign' => $name, 'clan_id' => $clan, 'source_clan_id' => $clan];
        $scored = ($this->identity ??= new PlayerIdentity)->resolve($literal, $clan);
        if (in_array($scored['status'], [PlayerIdentity::MATCHED, PlayerIdentity::PROBABLE], true)) {
            return $this->resolved[$cacheKey] = ['player_id' => $scored['player_id'], 'ign' => $scored['ign'], 'clan_id' => $scored['clan_id'], 'source_clan_id' => $clan];
        }
        if ($scored['status'] === PlayerIdentity::AMBIGUOUS) {
            return $this->resolved[$cacheKey] = [...$base,
                'unresolved' => 'Similar existing profiles: '.implode(', ', array_column(array_slice($scored['candidates'], 0, 3), 'ign')).'. Choose the actual player; their team total is retained.',
                'candidates' => array_map(fn (array $c): array => ['id' => $c['id'], 'ign' => $c['ign'], 'clan_id' => $c['clan_id'], 'status' => 'active'], array_slice($scored['candidates'], 0, 5)),
            ];
        }
        if ($ranked === []) {
            $cores = $this->nameCores($name);
            foreach ($this->profiles as $profile) {
                foreach ($profile['names'] as $candidate) {
                    $other = $this->nameCores($candidate);
                    if (array_intersect($cores, $other) !== [] || collect($cores)->contains(fn ($core): bool => strlen($core) >= 4 && collect($other)->contains(fn ($part): bool => strlen($part) >= 4 && PlayerNameSearch::similarity($core, $part) >= .9))) {
                        $ranked[] = $profile;
                        break;
                    }
                }
            }
        }
        if ($ranked !== []) {
            return $this->resolved[$cacheKey] = [...$base,
                'unresolved' => 'Similar existing profiles: '.implode(', ', array_column(array_slice($ranked, 0, 3), 'ign')).'. Choose the actual player; their team total is retained.',
                'candidates' => array_map(fn ($p): array => ['id' => $p['id'], 'ign' => $p['ign'], 'clan_id' => $p['clan_id'], 'status' => $p['status']], array_slice($ranked, 0, 5)),
            ];
        }
        if (! $create || $key === '' || mb_strlen($name) > 100) {
            return $this->resolved[$cacheKey] = [...$base, 'unresolved' => 'No existing profile identified. Team totals are retained until this player is identified.'];
        }

        return $this->resolved[$cacheKey] = [...$base, 'create_player' => true];
    }

    /** @param list<array<string, mixed>> $proposed
     * @return list<array<string, mixed>>
     */
    public function reviewProposed(array $proposed): array
    {
        $this->load();

        return array_map(function ($player): array {
            $resolution = $this->resolve($player['ign'], true);
            $existing = isset($resolution['player_id']) ? collect($this->profiles)->firstWhere('id', $resolution['player_id']) : null;

            return ['proposed_name' => $player['ign'], 'proposed_clan_id' => $player['clan_id'], 'resolution' => $resolution,
                'existing_profile_status' => $existing['status'] ?? null];
        }, $proposed);
    }

    /** Additional cores find possible duplicates; they never establish a player's identity automatically. */
    private function nameCores(string $name): array
    {
        $parts = [$name, ...(preg_split('/[|丨·・:]+/u', $name) ?: [])];
        $cores = [];
        foreach ($parts as $part) {
            $latin = preg_replace('/[^\p{Latin}\p{N}]/u', '', $this->fold($part)) ?? '';
            $key = trim(PlayerNameSearch::key($latin), '0123456789');
            if (strlen($key) >= 2) {
                $cores[] = $key;
            }
        }

        return array_values(array_unique($cores));
    }

    /** Recognize stored clan tags even when screenshots/exports use a different decorative separator. */
    private function split(string $literal): array
    {
        $literal = trim($literal);
        $standard = ClanTag::split($literal, $this->tags);
        if ($standard['tag'] !== null) {
            return ['name' => $standard['name'], 'clan_id' => $this->tagClans[PlayerNameSearch::key($standard['tag'])] ?? null];
        }
        $separators = '\\s"“”\\[\\](){}|丨·・･•∙⋅:;\\/\\\\\\-–—_~.✝†〆メ乂ヤャ×*';
        for ($length = min(12, mb_strlen($literal) - 1); $length > 0; $length--) {
            $prefix = mb_substr($literal, 0, $length);
            $key = $this->prefixKey($prefix);
            if (! isset($this->prefixClans[$key])) {
                continue;
            }
            $rest = mb_substr($literal, $length);
            $boundary = preg_match('/['.$separators.']$/u', $prefix) === 1 || preg_match('/^['.$separators.']/u', $rest) === 1;
            $numericOcrTag = preg_match('/^\\d+[a-z]+$/', $key) === 1 && preg_match('/^["“”]/u', $literal) === 1;
            if (! $boundary && ! $numericOcrTag) {
                continue;
            }
            $name = preg_replace('/^['.$separators.']+|['.$separators.']+$/u', '', $rest) ?? $rest;
            if ($name !== '') {
                return ['name' => $name, 'clan_id' => $this->prefixClans[$key]];
            }
        }

        return ['name' => $literal, 'clan_id' => null];
    }

    private function fold(string $value): string
    {
        return strtr($value, ['α' => 'A', 'Α' => 'A', '€' => 'E', 'Λ' => 'A', 'ム' => 'A', 'さ' => 'A', '¥' => 'Y']);
    }

    private function nameKey(string $value): string
    {
        return PlayerNameSearch::key($this->fold($value));
    }

    private function prefixKey(string $value): string
    {
        $key = preg_replace('/[^a-z0-9]/', '', $this->nameKey($value)) ?? '';
        $key = strtr($key, ['i' => '1', 'l' => '1']);

        return preg_replace('/1+/', '1', $key) ?? $key;
    }
}
