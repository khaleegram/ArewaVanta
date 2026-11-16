<?php

namespace App\Domain\Competition\Assistant;

use App\Domain\Competition\ClanTag;
use App\Domain\Competition\PlayerNameSearch;
use App\Models\Clan;
use App\Models\Player;

final class AssistantPlayerResolver
{
    private array $profiles = [];

    private array $tags = [];

    private array $tagClans = [];

    private array $resolved = [];

    public function load(): void
    {
        $this->profiles = $this->tags = $this->tagClans = $this->resolved = [];
        foreach (Clan::query()->get(['id', 'tag', 'tags']) as $clan) {
            foreach ($clan->tagList() as $tag) {
                $this->tags[] = $tag;
                $this->tagClans[PlayerNameSearch::key($tag)] = $clan->id;
            }
        }
        foreach (Player::query()->where('status', 'active')->with('aliases')->orderBy('id')->get() as $player) {
            $names = [$player->current_ign, ...$player->aliases->pluck('alias')->all()];
            $names = array_unique([...$names, ...array_map(fn ($name): string => ClanTag::strip($name, $this->tags), $names)]);
            $this->profiles[] = ['id' => $player->id, 'clan_id' => $player->clan_id, 'ign' => $player->current_ign, 'names' => $names];
        }
    }

    /** @return array{player_id?: string, ign: string, clan_id: ?string, source_clan_id: ?string, create_player?: bool, unresolved?: string} */
    public function resolve(string $literal, bool $create): array
    {
        $cacheKey = ($create ? 'create:' : 'find:').$literal;
        if (isset($this->resolved[$cacheKey])) {
            return $this->resolved[$cacheKey];
        }
        $split = ClanTag::split($literal, $this->tags);
        $name = $split['name'];
        $clan = $this->tagClans[PlayerNameSearch::key($split['tag'] ?? '')] ?? null;
        $key = PlayerNameSearch::key($name);
        $ranked = [];
        foreach ($this->profiles as $profile) {
            $exact = false;
            $score = 0.0;
            foreach ($profile['names'] as $candidate) {
                $exact = $exact || PlayerNameSearch::key($candidate) === $key || PlayerNameSearch::key($candidate) === PlayerNameSearch::key($literal);
                $score = max($score, PlayerNameSearch::similarity($candidate, $name));
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
        $match = count($exact) === 1 ? $exact[0] : null;
        if ($match === null && $exact === [] && strlen($key) >= 5 && ($ranked[0]['score'] ?? 0) >= .96
            && ($ranked[0]['score'] - ($ranked[1]['score'] ?? 0)) >= .07) {
            $match = $ranked[0];
        }
        if ($match !== null) {
            return $this->resolved[$cacheKey] = ['player_id' => $match['id'], 'ign' => $match['ign'], 'clan_id' => $match['clan_id'], 'source_clan_id' => $clan];
        }
        $base = ['ign' => $name, 'clan_id' => $clan, 'source_clan_id' => $clan];
        if ($ranked !== []) {
            return $this->resolved[$cacheKey] = [...$base, 'unresolved' => 'Similar existing profiles: '.implode(', ', array_column(array_slice($ranked, 0, 3), 'ign')).'. Choose the actual player; their team total is retained.'];
        }
        if (! $create || $key === '' || mb_strlen($name) > 100) {
            return $this->resolved[$cacheKey] = [...$base, 'unresolved' => 'No existing profile identified. Team totals are retained until this player is identified.'];
        }

        return $this->resolved[$cacheKey] = [...$base, 'create_player' => true];
    }
}
