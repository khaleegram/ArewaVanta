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
}
