<?php

namespace App\Domain\Competition\ScreenshotImport;

use App\Domain\Competition\PlayerNameSearch;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

final class DeepSeekScreenshotReader
{
    /**
     * @param  list<UploadedFile>  $images
     * @return array{teams: list<array<string, mixed>>, warnings: list<string>, model: string}
     */
    public function extract(array $images): array
    {
        $key = trim((string) config('services.deepseek.key'));
        if ($key === '') {
            throw new ScreenshotImportUnavailable('Screenshot import is not configured. Add DEEPSEEK_API_KEY to the API environment.');
        }

        $content = [['type' => 'text', 'text' => $this->prompt()]];
        foreach ($images as $image) {
            $path = $image->getRealPath();
            if ($path === false) {
                throw new ScreenshotImportFailed('One of the uploaded images could not be read.');
            }
            $mime = $image->getMimeType() ?: 'image/jpeg';
            $content[] = [
                'type' => 'image_url',
                'image_url' => [
                    'url' => 'data:'.$mime.';base64,'.base64_encode((string) file_get_contents($path)),
                    'detail' => 'original',
                ],
            ];
        }

        $model = (string) config('services.deepseek.model', 'deepseek-flash');
        $url = rtrim((string) config('services.deepseek.base_url', 'https://api.deepseek.com'), '/').'/chat/completions';

        try {
            $response = Http::withToken($key)
                ->acceptJson()
                ->timeout((int) config('services.deepseek.timeout', 90))
                ->post($url, [
                    'model' => $model,
                    'messages' => [['role' => 'user', 'content' => $content]],
                    'response_format' => ['type' => 'json_object'],
                    'temperature' => 0,
                    'max_tokens' => 16000,
                    'thinking' => ['type' => 'disabled'],
                ]);
        } catch (ConnectionException $exception) {
            Log::warning('DeepSeek screenshot import connection failed.', ['message' => $exception->getMessage()]);

            throw new ScreenshotImportFailed('The screenshot reader could not be reached. Try again or enter the scores manually.');
        }

        if (! $response->successful()) {
            Log::warning('DeepSeek screenshot import failed.', [
                'status' => $response->status(),
                'body' => mb_substr($response->body(), 0, 1000),
            ]);

            throw new ScreenshotImportFailed('The screenshot reader could not process these images. Try again or enter the scores manually.');
        }

        $text = data_get($response->json(), 'choices.0.message.content');
        if (! is_string($text) || trim($text) === '') {
            Log::warning('DeepSeek screenshot import returned no content.', ['response' => $response->json()]);

            throw new ScreenshotImportFailed('The screenshot reader returned an empty response. Try again.');
        }

        try {
            $decoded = json_decode($this->stripCodeFence($text), true, flags: JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            Log::warning('DeepSeek screenshot import returned invalid JSON.', ['content' => mb_substr($text, 0, 2000)]);

            throw new ScreenshotImportFailed('The screenshot reader returned an unreadable result. Try again.');
        }

        if (! is_array($decoded)) {
            throw new ScreenshotImportFailed('The screenshot reader returned an unreadable result. Try again.');
        }

        return $this->normalize($decoded, $model);
    }

    private function prompt(): string
    {
        return <<<'PROMPT'
Extract the Call of Duty Mobile Battle Royale result board from these screenshots.
Return JSON only, no markdown.

The screenshots may be scrolled or overlap. Merge the same TEAM number into one team object.
For every visible team return:
- team_label: exactly as printed, for example "TEAM12" or "Squad 1"
- team_number: only the integer after an explicit "TEAM" label, or null. Never
  treat a generic "Squad 1" label as a global slot number.
- team_clan: the clan name or tag printed above/on the team, or null
- placement: the team's rank/placement shown by the rank badge or rank number (1 = first place). This is NOT the kill count.
- team_kills: only if the board separately shows a team kill total; otherwise null
- players: every visible player observation, in the order shown. Teams normally have four players; retain extra names if overlapping images disagree so an organizer can resolve them. Each player:
  - name: the player name exactly as printed, including clan tag, punctuation and stylised characters
  - kills: the kill number shown beside that player, or null if unreadable

Rules:
- Never invent a player, placement or kill.
- Do not use "RANK", "DETAILS", "TEAM" or other UI labels as player names.
- If a player's kills are unreadable, use null. Do not use 0 unless 0 is printed.
- If the same team appears in several screenshots, combine its player rows.
- If the same player appears with different kill numbers, set kills to null, include all observed numbers in kills_options, and add a warning. Never pick the highest value automatically.
- If placements or separately printed team totals conflict, return separate observations for the same team so the organizer can review them.
- Ignore teams that are completely unreadable rather than guessing.
- Keep every visible player row, even when you are unsure whether it matches an existing player.

JSON shape:
{"teams":[{"team_label":"TEAM12","team_number":12,"placement":1,"team_kills":null,"players":[{"name":"PlayerName","kills":13}]}],"warnings":["..."]}
PROMPT;
    }

    /**
     * @param  array<string, mixed>  $decoded
     * @return array{teams: list<array<string, mixed>>, warnings: list<string>, model: string}
     */
    private function normalize(array $decoded, string $model): array
    {
        $teams = [];
        $warnings = [];
        foreach ((array) ($decoded['warnings'] ?? []) as $warning) {
            if (is_string($warning) && trim($warning) !== '') {
                $warnings[] = mb_substr(trim($warning), 0, 300);
            }
        }

        foreach ((array) ($decoded['teams'] ?? []) as $team) {
            if (! is_array($team)) {
                continue;
            }
            $label = trim((string) ($team['team_label'] ?? $team['team'] ?? ''));
            $number = $this->intValue($team['team_number'] ?? null);
            if ($number === null && $label !== '') {
                preg_match('/(\d{1,2})/', $label, $matches);
                $number = isset($matches[1]) ? (int) $matches[1] : null;
            }

            $players = [];
            foreach ((array) ($team['players'] ?? []) as $player) {
                if (! is_array($player)) {
                    continue;
                }
                $name = trim((string) ($player['name'] ?? $player['ign'] ?? ''));
                if ($name === '') {
                    continue;
                }
                $players[] = [
                    'name' => mb_substr($name, 0, 100),
                    'kills' => $this->intValue($player['kills'] ?? null, 0, 999),
                    'kills_options' => $this->values($player['kills_options'] ?? [], 0, 999),
                ];
                if (count($players) > 100) {
                    throw new ScreenshotImportFailed('Too many player observations were returned. Import fewer screenshots together.');
                }
            }

            if ($number === null && $players === []) {
                continue;
            }

            $teams[] = [
                'team_label' => $label !== '' ? mb_substr($label, 0, 40) : ($number === null ? 'Unknown team' : 'TEAM'.$number),
                'team_number' => $number,
                'placement' => $this->intValue($team['placement'] ?? null, 1, 100),
                'team_kills' => $this->intValue($team['team_kills'] ?? null, 0, 999),
                'placement_options' => $this->values($team['placement_options'] ?? [], 1, 100),
                'team_kills_options' => $this->values($team['team_kills_options'] ?? [], 0, 999),
                'players' => $players,
            ];
        }

        if ($teams === []) {
            throw new ScreenshotImportFailed('No readable teams were found in these screenshots.');
        }

        return [
            'teams' => $this->mergeTeams($teams, $warnings),
            'warnings' => array_values(array_unique($warnings)),
            'model' => $model,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $teams
     * @param  list<string>  $warnings
     * @return list<array<string, mixed>>
     */
    private function mergeTeams(array $teams, array &$warnings): array
    {
        $merged = [];
        foreach ($teams as $team) {
            $key = $team['team_number'] === null
                ? 'label:'.PlayerNameSearch::key((string) $team['team_label'])
                : 'number:'.$team['team_number'];
            $current = $merged[$key] ?? [...$team, 'players' => [], 'placement' => null, 'team_kills' => null, 'placement_options' => [], 'team_kills_options' => []];
            foreach (['placement', 'team_kills'] as $field) {
                $options = $this->values([
                    ...($current[$field.'_options'] ?? []), $current[$field], $team[$field],
                    ...($team[$field.'_options'] ?? []),
                ], $field === 'placement' ? 1 : 0, $field === 'placement' ? 100 : 999);
                $current[$field.'_options'] = $options;
                $current[$field] = count($options) === 1 ? $options[0] : null;
                if (count($options) > 1) {
                    $warnings[] = $team['team_label'].' has conflicting '.str_replace('_', ' ', $field).' values: '.implode(', ', $options).'. Choose the correct value in review.';
                }
            }
            foreach ($team['players'] as $player) {
                $playerKey = PlayerNameSearch::key((string) $player['name']);
                $existingIndex = null;
                foreach ($current['players'] as $index => $existing) {
                    if ($playerKey !== '' && PlayerNameSearch::key((string) $existing['name']) === $playerKey) {
                        $existingIndex = $index;
                        break;
                    }
                }
                $existing = $existingIndex === null ? null : $current['players'][$existingIndex];
                $options = $this->values([
                    ...($existing['kills_options'] ?? []), $existing['kills'] ?? null,
                    ...($player['kills_options'] ?? []), $player['kills'],
                ], 0, 999);
                $combined = [
                    ...($existing ?? $player),
                    'kills' => count($options) === 1 ? $options[0] : null,
                    'kills_options' => $options,
                ];
                if ($existingIndex === null) {
                    $current['players'][] = $combined;
                } else {
                    $current['players'][$existingIndex] = $combined;
                }
                if (count($options) > 1) {
                    $warnings[] = $team['team_label'].' '.$player['name'].' has conflicting kills: '.implode(', ', $options).'. Choose the correct value in review.';
                }
            }
            if (count($current['players']) > 4) {
                $warnings[] = $team['team_label'].' has '.count($current['players']).' player names. All have been kept; review spelling differences and select the actual participants.';
            }
            $merged[$key] = $current;
        }

        usort($merged, static fn (array $left, array $right): int => ($left['team_number'] ?? 999) <=> ($right['team_number'] ?? 999));

        return array_values($merged);
    }

    /** @return list<int> */
    private function values(mixed $values, int $minimum, int $maximum): array
    {
        $result = [];
        foreach ((array) $values as $value) {
            $number = $this->intValue($value, $minimum, $maximum);
            if ($number !== null && ! in_array($number, $result, true)) {
                $result[] = $number;
            }
        }

        return $result;
    }

    private function intValue(mixed $value, int $min = 0, int $max = 999): ?int
    {
        if (is_int($value)) {
            return $value >= $min && $value <= $max ? $value : null;
        }
        if (is_string($value) && preg_match('/^\s*(\d+)\s*$/', $value, $matches)) {
            $number = (int) $matches[1];

            return $number >= $min && $number <= $max ? $number : null;
        }

        return null;
    }

    private function stripCodeFence(string $text): string
    {
        $text = trim($text);
        if (str_starts_with($text, '```')) {
            $text = preg_replace('/^```(?:json)?\s*/i', '', $text) ?? $text;
            $text = preg_replace('/\s*```$/', '', $text) ?? $text;
        }

        return trim($text);
    }
}
