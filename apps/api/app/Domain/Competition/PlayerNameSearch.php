<?php

namespace App\Domain\Competition;

use Illuminate\Support\Str;
use Normalizer;

final class PlayerNameSearch
{
    public static function key(string $value): string
    {
        $value = Normalizer::normalize($value, Normalizer::FORM_KD) ?: $value;
        $value = strtr(Str::lower($value), [
            'ø' => 'o', 'ł' => 'l', 'đ' => 'd', 'ð' => 'd', 'þ' => 'th', 'æ' => 'ae', 'œ' => 'oe', 'ı' => 'i', 'ŋ' => 'n', 'ß' => 'ss',
            'ᴀ' => 'a', 'ʙ' => 'b', 'ᴄ' => 'c', 'ᴅ' => 'd', 'ᴇ' => 'e', 'ꜰ' => 'f', 'ɢ' => 'g', 'ʜ' => 'h', 'ɪ' => 'i', 'ᴊ' => 'j', 'ᴋ' => 'k', 'ʟ' => 'l', 'ᴍ' => 'm', 'ɴ' => 'n', 'ᴏ' => 'o', 'ᴘ' => 'p', 'ʀ' => 'r', 'ꜱ' => 's', 'ᴛ' => 't', 'ᴜ' => 'u', 'ᴠ' => 'v', 'ᴡ' => 'w', 'ʏ' => 'y', 'ᴢ' => 'z', 'ɲ' => 'n', 'ƒ' => 'f',
        ]);

        return preg_replace('/[^\p{L}\p{N}]/u', '', Str::ascii($value)) ?? '';
    }

    public static function matches(string $ign, string $query): bool
    {
        return str_contains(self::key($ign), self::key($query));
    }

    /**
     * Compare OCR/typed names that are similar but not identical. The key
     * collapses common OCR swaps and repeated characters before measuring the
     * edit distance, so "A4〆FLAMEZY" can be compared with "A4ャFLAMZY".
     */
    public static function similarity(string $left, string $right): float
    {
        $left = self::comparable($left);
        $right = self::comparable($right);
        if ($left === '' || $right === '') {
            return 0.0;
        }
        if ($left === $right) {
            return 1.0;
        }

        $length = max(strlen($left), strlen($right));
        $distance = levenshtein($left, $right);
        $ratio = max(0.0, 1.0 - ($distance / $length));
        $shorter = min(strlen($left), strlen($right));
        if ($shorter >= 3 && (str_contains($left, $right) || str_contains($right, $left))) {
            $ratio = max($ratio, 0.75 + (0.25 * ($shorter / $length)));
        }

        return $ratio;
    }

    private static function comparable(string $value): string
    {
        $key = self::key($value);
        $key = strtr($key, [
            '0' => 'o', '1' => 'l', '2' => 'z', '3' => 'e', '4' => 'a',
            '5' => 's', '6' => 'g', '7' => 't', '8' => 'b', '9' => 'g',
            'rn' => 'm', 'vv' => 'w',
        ]);

        return preg_replace('/(.)\1+/u', '$1', $key) ?? $key;
    }
}
