<?php

namespace App\Domain\Competition\Assistant;

/**
 * Finds the game an organizer names in plain words ("22nd nov 1st game", "Sunday game 2") so the
 * message wins over a stale game selector. Returns null unless exactly one scheduled game matches.
 */
final class AssistantGameMention
{
    private const MONTHS = ['jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];

    private const ORDINALS = ['first' => 1, 'second' => 2, 'third' => 3, 'fourth' => 4, 'fifth' => 5];

    /**
     * @param  list<array{id: string, date: string, game: int|string|null}>  $schedule
     */
    public static function find(string $text, array $schedule): ?string
    {
        $text = mb_strtolower($text);
        $game = null;
        if (preg_match('/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+game\b|\bgame\s*(?:no\.?|number|#)?\s*(\d{1,2})\b/u', $text, $m)) {
            $game = (int) ($m[1] !== '' ? $m[1] : $m[2]);
        } elseif (preg_match('/\b(first|second|third|fourth|fifth)\s+game\b/u', $text, $m)) {
            $game = self::ORDINALS[$m[1]];
        }

        $day = null;
        if (preg_match('/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/u', $text, $m)) {
            $day = ['day' => (int) $m[1], 'month' => self::MONTHS[$m[2]]];
        }
        $weekday = preg_match('/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u', $text, $m) ? $m[1] : null;
        if ($game === null && $day === null && $weekday === null) {
            return null;
        }

        $matches = array_values(array_filter($schedule, function (array $entry) use ($game, $day, $weekday): bool {
            $date = new \DateTimeImmutable($entry['date']);
            if ($day !== null && ((int) $date->format('j') !== $day['day'] || (int) $date->format('n') !== $day['month'])) {
                return false;
            }
            if ($weekday !== null && mb_strtolower($date->format('l')) !== $weekday) {
                return false;
            }

            return $game === null || (int) $entry['game'] === $game;
        }));

        return count($matches) === 1 && ($game !== null) && ($day !== null || $weekday !== null || count($schedule) === 1) ? $matches[0]['id'] : null;
    }
}
