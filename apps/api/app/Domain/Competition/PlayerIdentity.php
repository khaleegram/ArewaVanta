<?php

namespace App\Domain\Competition;

use App\Models\Clan;
use App\Models\Player;

/**
 * One scored answer to "which saved player is this printed name?". Slot context (the squad's
 * roster, its clan, players already seen on it) outranks raw spelling, because a misread name on
 * a clan's own slot is almost always that clan's player. Never creates anything: callers decide
 * what to do with a "new" or "ambiguous" outcome.
 */
final class PlayerIdentity
{
    public const MATCHED = 'matched';

    public const PROBABLE = 'probable';

    public const AMBIGUOUS = 'ambiguous';

    public const NEW = 'new';

    /** @var list<array{id: string, ign: string, clan_id: ?string, status: string, names: list<string>}>|null */
    private ?array $profiles = null;

    /** @var list<string> */
    private array $tags = [];

    /** @var array<string, string> prefix key => clan id */
    private array $prefixClans = [];

    /**
     * @param  list<string>  $contextPlayerIds  players known on the slot's squad (roster, eligible, saved results)
     * @param  list<string>  $excludePlayerIds  players already placed on another team in this sheet
     * @return array{status: string, player_id: ?string, ign: ?string, clan_id: ?string, confidence: float, reason: string, candidates: list<array{id: string, ign: string, clan_id: ?string, confidence: float}>}
     */
    public function resolve(string $literal, ?string $slotClanId = null, array $contextPlayerIds = [], array $excludePlayerIds = []): array
    {
        $this->load();
        $split = $this->split($literal);
        $name = $split['name'];
        $tagClan = $split['clan_id'];
        $exactKey = PlayerNameSearch::key($literal);
        $segments = preg_split('/[|丨·・:]+/u', $name) ?: [$name];
        $core = trim((string) end($segments));
        $name = $core !== '' && PlayerNameSearch::key($core) !== '' ? $core : $name;
        $cleanKey = PlayerNameSearch::key($this->fold($name));
        if ($cleanKey === '') {
            return $this->outcome(self::NEW, null, 0.0, 'The name has no readable characters.', []);
        }

        $scored = [];
        foreach ($this->profiles as $profile) {
            if (in_array($profile['id'], $excludePlayerIds, true)) {
                continue;
            }
            $base = 0.0;
            $kind = 'similar spelling';
            foreach ($profile['names'] as $candidate) {
                $candidateKey = PlayerNameSearch::key($this->fold($candidate));
                if ($candidateKey === $exactKey && $exactKey !== '') {
                    $base = max($base, 1.0);
                    $kind = 'exact name';
                } elseif ($candidateKey === $cleanKey) {
                    $base = max($base, .97);
                    $kind = 'same name without the clan tag';
                } else {
                    $similarity = PlayerNameSearch::similarity($this->fold($candidate), $name);
                    if (strlen($candidateKey) >= 5 && str_contains($cleanKey, $candidateKey)) {
                        $similarity = max($similarity, .92 + .12 * (strlen($candidateKey) / strlen($cleanKey)));
                    }
                    if ($similarity > $base) {
                        $base = $similarity;
                        $kind = 'similar spelling';
                    }
                }
            }
            if ($base < .55) {
                continue;
            }
            $score = $base;
            $notes = [$kind];
            if (in_array($profile['id'], $contextPlayerIds, true)) {
                $score += .06;
                $notes[] = 'on this slot\'s squad';
            }
            if ($slotClanId !== null && $profile['clan_id'] === $slotClanId) {
                $score += .04;
                $notes[] = 'in the slot\'s clan';
            } elseif ($tagClan !== null && $profile['clan_id'] === $tagClan) {
                $score += .03;
                $notes[] = 'matches the printed clan tag';
            }
            if ($profile['status'] !== 'active') {
                $score -= .03;
            }
            $scored[] = ['profile' => $profile, 'score' => $score, 'base' => $base, 'notes' => $notes];
        }
        usort($scored, fn (array $a, array $b): int => $b['score'] <=> $a['score']);
        $candidates = array_map(fn (array $s): array => ['id' => $s['profile']['id'], 'ign' => $s['profile']['ign'], 'clan_id' => $s['profile']['clan_id'], 'confidence' => round(min(1.0, $s['score']), 2)], array_slice($scored, 0, 4));
        if ($scored === []) {
            return $this->outcome(self::NEW, null, 0.0, 'No saved profile has a similar name.', [], $tagClan ?? $slotClanId);
        }

        $top = $scored[0];
        $gap = $top['score'] - ($scored[1]['score'] ?? 0.0);
        $reason = ucfirst(implode(', ', $top['notes']));
        $short = strlen($cleanKey) < 4 && ! (in_array('on this slot\'s squad', $top['notes'], true) && $top['base'] >= .85);
        if ($top['base'] >= .97 && $gap >= .04) {
            return $this->outcome(self::MATCHED, $top['profile'], $top['score'], $reason, $candidates);
        }
        if (! $short && $top['base'] >= .9 && $gap >= .2) {
            return $this->outcome(self::PROBABLE, $top['profile'], $top['score'], $reason.', and no other profile is close', $candidates);
        }
        $contextual = in_array('on this slot\'s squad', $top['notes'], true) || in_array('in the slot\'s clan', $top['notes'], true);
        if (! $short && $top['score'] >= ($contextual ? .74 : .93) && $gap >= .08) {
            return $this->outcome(self::PROBABLE, $top['profile'], $top['score'], $reason, $candidates);
        }

        if ($top['base'] < .72) {
            return $this->outcome(self::NEW, null, $top['score'], 'No saved profile has a close enough name.', [], $tagClan ?? $slotClanId);
        }

        return $this->outcome(self::AMBIGUOUS, null, $top['score'], 'Several saved profiles look similar. Choose the actual player.', $candidates, $tagClan ?? $slotClanId);
    }

    /**
     * @param  array<string, mixed>|null  $profile
     * @param  list<array<string, mixed>>  $candidates
     * @return array<string, mixed>
     */
    private function outcome(string $status, ?array $profile, float $confidence, string $reason, array $candidates, ?string $clanId = null): array
    {
        return [
            'status' => $status, 'player_id' => $profile['id'] ?? null, 'ign' => $profile['ign'] ?? null,
            'clan_id' => $profile['clan_id'] ?? $clanId, 'confidence' => round(min(1.0, $confidence), 2), 'reason' => $reason, 'candidates' => $candidates,
        ];
    }

    private function load(): void
    {
        if ($this->profiles !== null) {
            return;
        }
        foreach (Clan::query()->get(['id', 'tag', 'tags']) as $clan) {
            foreach ($clan->tagList() as $tag) {
                $this->tags[] = $tag;
                $prefix = $this->prefixKey($tag);
                if ($prefix !== '') {
                    $this->prefixClans[$prefix] = $clan->id;
                }
            }
        }
        $this->profiles = [];
        foreach (Player::query()->with('aliases:id,player_id,alias')->get(['id', 'current_ign', 'clan_id', 'status']) as $player) {
            $names = [$player->current_ign, ...$player->aliases->pluck('alias')->all()];
            $names = array_values(array_unique([...$names, ...array_map(fn (string $n): string => ClanTag::strip($n, $this->tags), $names)]));
            $this->profiles[] = ['id' => $player->id, 'ign' => $player->current_ign, 'clan_id' => $player->clan_id, 'status' => $player->status, 'names' => $names];
        }
    }

    /** @return array{name: string, clan_id: ?string} */
    private function split(string $literal): array
    {
        $literal = trim($literal);
        $standard = ClanTag::split($literal, $this->tags);
        if ($standard['tag'] !== null) {
            $clanId = $this->prefixClans[$this->prefixKey($standard['tag'])] ?? null;

            return ['name' => $standard['name'], 'clan_id' => $clanId];
        }
        $separators = '\\s"“”\\[\\](){}|丨·・･•∙⋅:;\\/\\\\\\-–—_~.✝†〆メ乂ヤャ×✕*';
        for ($length = min(12, mb_strlen($literal) - 1); $length > 0; $length--) {
            $prefix = mb_substr($literal, 0, $length);
            $key = $this->prefixKey($prefix);
            if (! isset($this->prefixClans[$key])) {
                continue;
            }
            $rest = mb_substr($literal, $length);
            $boundary = preg_match('/['.$separators.']$/u', $prefix) === 1 || preg_match('/^['.$separators.']/u', $rest) === 1;
            if (! $boundary) {
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
        return strtr($value, ['α' => 'A', 'Α' => 'A', '€' => 'E', 'Λ' => 'A', 'ム' => 'A', 'さ' => 'A', '¥' => 'Y', 'Ɓ' => 'B', 'Ƛ' => 'A', 'ƛ' => 'a', 'ƈ' => 'c']);
    }

    private function prefixKey(string $value): string
    {
        $key = preg_replace('/[^a-z0-9]/', '', PlayerNameSearch::key($this->fold($value))) ?? '';
        $key = strtr($key, ['i' => '1', 'l' => '1']);

        return preg_replace('/1+/', '1', $key) ?? $key;
    }
}
