<?php

namespace App\Domain\Competition\Assistant;

use App\Domain\Competition\ResultPermissions;
use App\Domain\Competition\ScreenshotImport\DeepSeekScreenshotReader;
use App\Domain\Competition\ScreenshotImport\ScreenshotResultMapper;
use App\Http\Controllers\Api\V1\Manage\MatchResultSheetController;
use App\Models\AssistantEvidence;
use App\Models\CompetitionMatch;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Reads scoreboard screenshots with the same extractor and slot mapper as the Enter results
 * import, then prepares result corrections in code so the language model cannot refuse or
 * miscount them. Slot (TEAM number) is the identity; unknown values stay unknown.
 */
final class AssistantScoreboards
{
    public function __construct(
        private readonly DeepSeekScreenshotReader $reader,
        private readonly ScreenshotResultMapper $mapper,
        private readonly AssistantPlayerResolver $directory,
        private readonly ResultPermissions $permissions,
    ) {}

    /**
     * @param  list<AssistantEvidence>  $images
     * @param  array<string, mixed>  $context
     * @return array{status: string, match_id: ?string, game_source: ?string, corrections: list<array<string, mixed>>, warnings: list<string>, teams: list<array<string, mixed>>, candidates: list<array<string, mixed>>, observations: list<array<string, mixed>>, model: ?string}
     */
    public function read(User $actor, array $images, array $context, ?string $focusMatchId): array
    {
        $files = [];
        foreach ($images as $image) {
            $bytes = Storage::disk($image->disk)->get($image->path);
            if (is_string($bytes)) {
                $files[] = ['bytes' => $bytes, 'mime' => $image->mime];
            }
        }
        $extraction = $this->reader->extractBytes($files);
        $observations = $this->observations($extraction, count($files));

        $candidates = [];
        $sheets = [];
        $loaded = collect($context['matches'])->keyBy('id');
        $matchIds = $focusMatchId !== null ? [$focusMatchId] : array_column($context['schedule'], 'id');
        foreach ($matchIds as $matchId) {
            $match = CompetitionMatch::query()->find($matchId);
            if ($match === null) {
                continue;
            }
            $mapped = $this->mapper->map($extraction, $this->sheet($actor, $match));
            $sheets[$matchId] = $mapped;
            $entry = collect($context['schedule'])->firstWhere('id', $matchId) ?? [];
            $candidates[] = [
                'match_id' => $matchId, 'date' => $entry['date'] ?? null, 'game' => $entry['game'] ?? null,
                'matched_teams' => $mapped['summary']['matched_teams'], 'unresolved_teams' => $mapped['summary']['unresolved_teams'],
                'has_saved_results' => ! empty($loaded->get($matchId)['results']),
                'score' => 3 * $mapped['summary']['matched_teams'] - 2 * $mapped['summary']['unresolved_teams'],
            ];
        }
        usort($candidates, fn (array $a, array $b): int => $b['score'] <=> $a['score']);

        $chosen = null;
        $source = null;
        if ($focusMatchId !== null && isset($sheets[$focusMatchId])) {
            $chosen = $focusMatchId;
            $source = 'organizer_selected';
        } elseif ($candidates !== [] && $candidates[0]['score'] > 0 && $candidates[0]['score'] > ($candidates[1]['score'] ?? PHP_INT_MIN)) {
            $chosen = $candidates[0]['match_id'];
            $source = 'identified_from_slot_lineups';
        }

        $base = [
            'match_id' => $chosen, 'game_source' => $source, 'candidates' => array_map(fn (array $c): array => collect($c)->except('score')->all(), array_slice($candidates, 0, 6)),
            'observations' => $observations, 'model' => $extraction['model'] ?? null,
        ];
        if ($chosen === null) {
            return [...$base, 'status' => 'needs_game', 'corrections' => [], 'teams' => [],
                'warnings' => ['The scoreboard was read, but no single saved game matches it clearly. Select the game and send again.']];
        }

        $mapped = $sheets[$chosen];
        $built = $this->corrections($chosen, $mapped, $loaded->get($chosen), $context, array_map(fn (AssistantEvidence $image): string => $image->id, $images));

        return [...$base, 'status' => 'prepared', 'corrections' => $built['corrections'],
            'warnings' => array_values(array_unique([...$mapped['warnings'], ...$built['warnings']])),
            'teams' => array_map(fn (array $team): array => [
                'team' => $team['team_label'], 'placement' => $team['placement'], 'slot_status' => $team['status'],
                'squad' => $team['squad']['name'] ?? null,
                'players' => array_map(fn (array $p): array => ['name' => $p['name'], 'kills' => $p['kills'], 'status' => $p['status'], 'profile' => $p['ign'] ?? null], $team['players']),
            ], $mapped['teams'])];
    }

    /** @return array<string, mixed> */
    private function sheet(User $actor, CompetitionMatch $match): array
    {
        $request = Request::create('/');
        $request->setUserResolver(fn (): User => $actor);

        return app(MatchResultSheetController::class)($request, $match, $this->permissions)->getData(true)['data'];
    }

    /**
     * Merged reading stored on every image so the proof dialog shows what was read.
     *
     * @param  array{teams: list<array<string, mixed>>, warnings: list<string>}  $extraction
     * @return list<array<string, mixed>>
     */
    private function observations(array $extraction, int $imageCount): array
    {
        return array_values(array_map(function (array $team) use ($imageCount): array {
            $players = array_values(array_map(fn (array $p): array => ['name' => (string) $p['name'], 'kills' => is_int($p['kills'] ?? null) ? $p['kills'] : null], (array) ($team['players'] ?? [])));

            return [
                'kind' => 'scoreboard', 'printed_datetime' => null, 'map' => null,
                'team_number' => $team['team_number'] ?? null, 'placement' => $team['placement'] ?? null,
                'lobby_teams' => null, 'team_kills' => $team['team_kills'] ?? null, 'players' => $players,
                'note' => 'Merged across '.$imageCount.' screenshot(s) by the scoreboard reader.',
                'visible_player_kills' => array_sum(array_column($players, 'kills')),
                'all_visible_kills_read' => $players !== [] && ! in_array(null, array_column($players, 'kills'), true),
            ];
        }, $extraction['teams']));
    }

    /**
     * @param  array<string, mixed>  $mapped
     * @param  array<string, mixed>|null  $loadedMatch
     * @param  array<string, mixed>  $context
     * @param  list<string>  $evidenceIds
     * @return array{corrections: list<array<string, mixed>>, warnings: list<string>}
     */
    private function corrections(string $matchId, array $mapped, ?array $loadedMatch, array $context, array $evidenceIds): array
    {
        $this->directory->load();
        $saved = collect($loadedMatch['results'] ?? [])->keyBy('squad_id');
        $squadSize = (int) ($context['event']['squad_size'] ?? 4);
        $corrections = [];
        $warnings = [];
        foreach ($mapped['teams'] as $team) {
            $label = $team['team_label'];
            if ($team['status'] !== 'matched') {
                $warnings[] = $label.' was not entered: '.($team['status'] === 'roster_mismatch'
                    ? 'its players look like another squad than the one assigned to that slot. Slot is the identity, so confirm the slot first.'
                    : 'it has no saved slot in this game. Assign the slot, then resend.');

                continue;
            }
            $changes = ['status' => 'present'];
            if ($team['placement'] !== null) {
                $changes['placement'] = $team['placement'];
            }
            $updates = [];
            $visible = 0;
            $anyKills = false;
            foreach ($team['players'] as $player) {
                $kills = $player['kills'];
                if ($kills !== null) {
                    $visible += $kills;
                    $anyKills = true;
                }
                $update = $this->playerUpdate($player, $kills);
                if ($update === null) {
                    $warnings[] = $player['name'].' ('.$label.') is not attributed to a profile'.($kills !== null ? '; their '.$kills.' kills stay in the team total' : '').'. Tell me which player this is.';

                    continue;
                }
                $updates[] = $update;
            }
            if ($updates !== []) {
                $changes['player_updates'] = $updates;
            }
            $total = $team['team_kills'] ?? ($anyKills ? $visible : null);
            if ($total !== null) {
                $previous = $saved->get($team['squad']['id'])['team_kills'] ?? null;
                $changes['team_kills'] = max($total, (int) $previous);
            }
            if ($team['team_kills'] === null && count($team['players']) < $squadSize) {
                $warnings[] = $label.' shows '.count($team['players']).' of '.$squadSize.' players, so its team total is a lower bound.';
            }
            $corrections[] = [
                'match_id' => $matchId, 'squad_id' => $team['squad']['id'],
                'reason' => 'Scoreboard screenshots: '.$label.' placed '.($team['placement'] ?? 'unknown').', mapped to saved slot '.$team['team_number'].'.',
                'evidence_ids' => $evidenceIds, 'changes' => $changes,
            ];
        }

        return ['corrections' => $corrections, 'warnings' => $warnings];
    }

    /**
     * @param  array<string, mixed>  $player
     * @return array<string, mixed>|null
     */
    private function playerUpdate(array $player, ?int $kills): ?array
    {
        if (in_array($player['status'], ['matched', 'other_squad'], true) && ! empty($player['player_id'])) {
            return ['player_id' => $player['player_id'], 'kills' => $kills];
        }
        if ($player['status'] !== 'new') {
            return null;
        }
        $resolved = $this->directory->resolve($player['name'], true);
        if (isset($resolved['player_id'])) {
            return ['player_id' => $resolved['player_id'], 'kills' => $kills];
        }
        if (! empty($resolved['create_player'])) {
            return ['create_player' => true, 'ign' => $resolved['ign'], 'clan_id' => $resolved['clan_id'], 'kills' => $kills];
        }

        return null;
    }
}
