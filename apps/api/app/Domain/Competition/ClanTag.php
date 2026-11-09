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
            $clean = self::stripExact($clean, $tag);
        }
        $token = self::tokenSplit($clean, $tags);
        if ($token !== null) {
            $clean = $token['name'];
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
            $clean = self::stripExact($original, $tag);
            if ($clean !== $original) {
                return ['tag' => $tag, 'name' => $clean];
            }
        }

        $token = self::tokenSplit($original, $tags);

        return $token ?? ['tag' => null, 'name' => $original];
    }

    private static function stripExact(string $name, string $tag): string
    {
        $quoted = preg_quote($tag, '/');
        $prefixBoundary = self::endsWithSeparator($tag)
            ? '\s*'
            : '\s*(?:['.self::REGEX_SEPARATORS.']\s*|\s+)';
        $suffixBoundary = self::startsWithSeparator($tag)
            ? '\s*'
            : '\s*(?:['.self::REGEX_SEPARATORS.']\s*|\s+)';
        $patterns = [
            '/^\[\s*'.$quoted.'\s*\]\s*/iu',
            '/^\(\s*'.$quoted.'\s*\)\s*/iu',
            '/^\{\s*'.$quoted.'\s*\}\s*/iu',
            '/^【\s*'.$quoted.'\s*】\s*/iu',
            '/^「\s*'.$quoted.'\s*」\s*/iu',
            '/^'.$quoted.$prefixBoundary.'/iu',
            '/'.$suffixBoundary.$quoted.'\s*$/iu',
            '/\s*\[\s*'.$quoted.'\s*\]\s*$/iu',
            '/\s*\(\s*'.$quoted.'\s*\)\s*$/iu',
            '/\s*【\s*'.$quoted.'\s*】\s*$/iu',
            '/\s*「\s*'.$quoted.'\s*」\s*$/iu',
        ];
        $clean = $name;
        foreach ($patterns as $pattern) {
            $candidate = preg_replace($pattern, '', $clean);
            if ($candidate === null) {
                continue;
            }
            // trim() is byte-based, so a multibyte separator list can split a
            // Japanese/CJK character. Trim with the regex instead.
            $candidate = self::trimSeparators($candidate);
            if ($candidate !== '') {
                $clean = $candidate;
            }
        }

        return $clean;
    }

    /**
     * Match a tag token even when names use a shortened or stylised version,
     * for example `¹P` for the clan tag `¹P丨`.
     *
     * @param  list<string>  $tags
     * @return array{tag: string, name: string}|null
     */
    private static function tokenSplit(string $name, array $tags): ?array
    {
        $tagKeys = [];
        foreach ($tags as $tag) {
            $tagKeys[PlayerNameSearch::key($tag)] = $tag;
        }
        if ($tagKeys === []) {
            return null;
        }

        $candidates = [];
        if (preg_match('/^\s*(?:[\[\(\{【「])\s*([^\]\)\}】」]{1,32})\s*(?:[\]\)\}】」])\s*(.+)$/u', $name, $match)) {
            $candidates[] = [$match[1], $match[2]];
        }
        if (preg_match('/^\s*([^\s|·・･•∙⋅:;\/\\\\–—_~]{1,32})\s*['.self::TOKEN_REGEX_SEPARATORS.']\s*(.+)$/u', $name, $match)) {
            $candidates[] = [$match[1], $match[2]];
        }
        if (preg_match('/^(.+?)\s*['.self::TOKEN_REGEX_SEPARATORS.']\s*([^\s|·・･•∙⋅:;\/\\\\–—_~]{1,32})\s*$/u', $name, $match)) {
            $candidates[] = [$match[2], $match[1]];
        }
        if (preg_match('/^\s*([^\s]{1,32})\s+(.+)$/u', $name, $match)) {
            $candidates[] = [$match[1], $match[2]];
        }

        foreach ($candidates as [$tagToken, $playerName]) {
            $key = PlayerNameSearch::key($tagToken);
            if ($key === '' || ! isset($tagKeys[$key])) {
                continue;
            }
            $clean = self::trimSeparators(trim($playerName));
            if ($clean !== '') {
                return ['tag' => $tagKeys[$key], 'name' => $clean];
            }
        }

        return null;
    }

    private static function endsWithSeparator(string $tag): bool
    {
        return preg_match('/['.self::REGEX_SEPARATORS.']$/u', $tag) === 1;
    }

    private static function startsWithSeparator(string $tag): bool
    {
        return preg_match('/^['.self::REGEX_SEPARATORS.']/u', $tag) === 1;
    }

    private static function trimSeparators(string $value): string
    {
        return preg_replace(
            '/^['.self::REGEX_SEPARATORS.'\s]+|['.self::REGEX_SEPARATORS.'\s]+$/u',
            '',
            $value,
        ) ?? $value;
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
