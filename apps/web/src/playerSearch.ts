const plainLetters: Record<string, string> = {
  "ø": "o", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "æ": "ae", "œ": "oe", "ı": "i", "ŋ": "n", "ß": "ss",
  "ᴀ": "a", "ʙ": "b", "ᴄ": "c", "ᴅ": "d", "ᴇ": "e", "ꜰ": "f", "ɢ": "g", "ʜ": "h", "ɪ": "i", "ᴊ": "j", "ᴋ": "k", "ʟ": "l", "ᴍ": "m", "ɴ": "n", "ᴏ": "o", "ᴘ": "p", "ʀ": "r", "ꜱ": "s", "ᴛ": "t", "ᴜ": "u", "ᴠ": "v", "ᴡ": "w", "ʏ": "y", "ᴢ": "z", "ɲ": "n", "ƒ": "f",
};

export function playerSearchKey(value: string): string {
  return Array.from(value.normalize("NFKD").toLocaleLowerCase())
    .map((letter) => plainLetters[letter] ?? letter).join("")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function matchesPlayerSearch(ign: string, query: string): boolean {
  return playerSearchKey(ign).includes(playerSearchKey(query));
}
