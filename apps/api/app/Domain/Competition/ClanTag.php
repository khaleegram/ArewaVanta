<?php

namespace App\Domain\Competition;

use Illuminate\Support\Str;

/**
 * Clan tags are stored separately from a player's name. These helpers keep the
 * same identity rules used by manual entry, roster imports and OCR review.
 */
final class ClanTag
{
    private const REGEX_SEPARATORS = '|·・･•∙⋅:;\/\\\\\-–—_~';
    private const TOKEN_REGEX_SEPARATORS = '|·・･•∙⋅:;\/\\\\–—_~';

    /** @return list<string> */
    public static function normalizeList(mixed $value): array
    {
        $parts = is_string($value)
            ? (preg_split('/[,;]+/', $value) ?: [])
            : (is_array($value) ? $value : []);

        $tags = [];
        foreach ($parts as $part) {
            if (! is_string($part)) {
                continue;
            }
            $tag = Str::upper(trim($part));
            if ($tag !== '') {
                $tags[$tag] = true;
            }
        }

        return array_keys($tags);
    }

    /** @param list<string> $tags */
    public static function strip(string $name, array $tags): string
    {
        $original = trim($name);
        $clean = $original;

        foreach (self::sorted($tags) as $tag) {
            $quoted = preg_quote($tag, '/');
            $patterns = [
                '/^\[\s*'.$quoted.'\s*\]\s*/iu',
                '/^\(\s*'.$quoted.'\s*\)\s*/iu',
                '/^\{\s*'.$quoted.'\s*\}\s*/iu',
                '/^【\s*'.$quoted.'\s*】\s*/iu',
                '/^「\s*'.$quoted.'\s*」\s*/iu',
                '/^'.$quoted.'\s*['.self::REGEX_SEPARATORS.']\s*/iu',
                '/\s*['.self::REGEX_SEPARATORS.']\s*'.$quoted.'\s*$/iu',
                '/\s*\[\s*'.$quoted.'\s*\]\s*$/iu',
                '/\s*\(\s*'.$quoted.'\s*\)\s*$/iu',
                '/\s*【\s*'.$quoted.'\s*】\s*$/iu',
                '/\s*「\s*'.$quoted.'\s*」\s*$/iu',
                '/^'.$quoted.'\s+/iu',
            ];
            foreach ($patterns as $pattern) {
                $candidate = preg_replace($pattern, '', $clean);
                if ($candidate === null) {
                    continue;
                }
                // trim() is byte-based, so a multibyte separator list can
                // split a Japanese/CJK character. Trim with the regex instead.
                $candidate = preg_replace(
                    '/^['.self::REGEX_SEPARATORS.'\s]+|['.self::REGEX_SEPARATORS.'\s]+$/u',
                    '',
                    $candidate,
                ) ?? $candidate;
                if ($candidate !== '') {
                    $clean = $candidate;
                }
            }
        }

        return $clean !== '' ? $clean : $original;
    }

    /**
     * @param  list<string>  $tags
     * @return array{tag: string|null, name: string}
     */
    public static function split(string $name, array $tags): array
    {
        $original = trim($name);
        foreach (self::sorted($tags) as $tag) {
            $clean = self::strip($original, [$tag]);
            if ($clean !== $original) {
                return ['tag' => $tag, 'name' => $clean];
            }
        }

        // OCR often stylises a tag or changes its spacing/punctuation. Compare
        // the separated token using the same normalisation as player names.
        $tagKeys = [];
        foreach ($tags as $tag) {
            $tagKeys[PlayerNameSearch::key($tag)] = $tag;
        }
        $candidates = [];
        if (preg_match('/^\s*(?:[\[\(\{【「])\s*([^\]\)\}】」]{1,32})\s*(?:[\]\)\}】」])\s*(.+)$/u', $original, $match)) {
            $candidates[] = [$match[1], $match[2]];
        }
        if (preg_match('/^\s*([^\s|·・･•∙⋅:;\/\\\\–—_~]{1,32})\s*['.self::TOKEN_REGEX_SEPARATORS.']\s*(.+)$/u', $original, $match)) {
            $candidates[] = [$match[1], $match[2]];
        }
        if (preg_match('/^(.+?)\s*['.self::TOKEN_REGEX_SEPARATORS.']\s*([^\s|·・･•∙⋅:;\/\\\\–—_~]{1,32})\s*$/u', $original, $match)) {
            $candidates[] = [$match[2], $match[1]];
        }
        if (preg_match('/^\s*([^\s]{1,32})\s+(.+)$/u', $original, $match)) {
            $candidates[] = [$match[1], $match[2]];
        }
        foreach ($candidates as [$tagToken, $playerName]) {
            $key = PlayerNameSearch::key($tagToken);
            if ($key !== '' && isset($tagKeys[$key]) && trim($playerName) !== '') {
                return ['tag' => $tagKeys[$key], 'name' => trim($playerName)];
            }
        }

        return ['tag' => null, 'name' => $original];
    }

    /** @param list<string> $tags @return list<string> */
    private static function sorted(array $tags): array
    {
        $tags = array_values(array_unique(array_filter(
            array_map(static fn (mixed $tag): string => is_string($tag) ? trim($tag) : '', $tags),
        )));
        usort($tags, static fn (string $a, string $b): int => mb_strlen($b) <=> mb_strlen($a));

        return $tags;
    }
}
