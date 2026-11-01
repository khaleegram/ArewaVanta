<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\BuildEventStandings;
use App\Domain\Competition\ResultPermissions;
use App\Http\Controllers\Controller;
use App\Models\CompetitionEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class EventExportController extends Controller
{
    public function checkIn(Request $request, CompetitionEvent $event, ResultPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManage($request->user(), $event), 403);
        $event->load('days');
        $entries = $event->squadEntries()->where('status', 'active')->orderBy('slot_number')->with([
            'squad.clan',
            'squad.memberships' => fn ($query) => $query->whereNull('left_at')->orderBy('joined_at')->with('player'),
        ])->get();

        return response()->json(['data' => [
            'generated_at' => now()->toIso8601String(),
            'event' => [
                'id' => $event->id, 'title' => $event->title, 'timezone' => $event->timezone,
                'squad_capacity' => $event->squad_capacity, 'squad_size' => $event->squad_size,
                'days' => $event->days->map(fn ($day): array => [
                    'id' => $day->id, 'date' => $day->event_date->toDateString(), 'label' => $day->label,
                ])->values(),
            ],
            'slots' => $entries->map(fn ($entry): array => [
                'slot_number' => $entry->slot_number,
                'squad' => ['id' => $entry->squad->id, 'name' => $entry->squad->name, 'number' => $entry->squad->squad_number],
                'clan' => ['name' => $entry->squad->clan->name, 'tag' => $entry->squad->clan->tag],
                'players' => $entry->squad->memberships
                    ->filter(fn ($membership): bool => $membership->player?->status === 'active'
                        && $membership->player->clan_id === $entry->squad->clan_id)
                    ->map(fn ($membership): array => ['id' => $membership->player_id, 'ign' => $membership->player->current_ign])
                    ->unique('id')->values(),
            ])->values(),
        ]])->header('Cache-Control', 'private, no-store');
    }

    public function results(Request $request, CompetitionEvent $event, ResultPermissions $permissions): StreamedResponse
    {
        abort_unless($permissions->canManage($request->user(), $event), 403);
        $event->load('days.matches.currentResult.squadResults.playerResults');

        return response()->streamDownload(function () use ($event): void {
            $output = fopen('php://output', 'w');
            $this->write($output, [
                'event', 'date', 'game', 'map', 'scoring_preset',
                'squad_id', 'squad_name', 'participation', 'placement', 'team_kills', 'kill_points', 'placement_points',
                'placement_multiplier', 'total_points', 'player_id', 'ign', 'player_kills',
            ]);
            foreach ($event->days as $day) {
                foreach ($day->matches as $match) {
                    if ($match->currentResult !== null) {
                        foreach ($match->currentResult->squadResults as $result) {
                            $players = $result->playerResults->isEmpty() ? [null] : $result->playerResults;
                            foreach ($players as $player) {
                                $this->write($output, [
                                    $event->title, $day->event_date->toDateString(), $match->match_index, $match->map_label,
                                    $match->rules_snapshot['preset_name'] ?? '',
                                    $result->squad_id, $result->squad_name_snapshot, $result->participation_status,
                                    $result->placement, $result->team_kills, $result->kill_points, $result->placement_points,
                                    $result->placement_multiplier, $result->total_points, $player?->player_id,
                                    $player?->ign_snapshot, $player?->kills,
                                ]);
                            }
                        }
                    }
                }
            }
            fclose($output);
        }, $event->slug.'-results.csv', ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'no-store']);
    }

    public function standings(Request $request, CompetitionEvent $event, ResultPermissions $permissions, BuildEventStandings $buildStandings): StreamedResponse
    {
        abort_unless($permissions->canManage($request->user(), $event), 403);
        $standings = $buildStandings->handle($event)['standings'];

        return response()->streamDownload(function () use ($standings): void {
            $output = fopen('php://output', 'w');
            $this->write($output, ['rank', 'squad_id', 'squad', 'clan', 'matches_played', 'kills', 'wins', 'total_points', 'placement_points', 'multiplier_scored_points']);
            foreach ($standings as $row) {
                $this->write($output, [
                    $row['rank'], $row['squad']['id'], $row['squad']['name'], $row['squad']['clan']['name'],
                    $row['matches_played'], $row['total_kills'], $row['wins'], $row['total_points'],
                    $row['additive_placement_points'], $row['multiplier_scored_points'],
                ]);
            }
            fclose($output);
        }, $event->slug.'-standings.csv', ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'no-store']);
    }

    /** @param resource $output @param array<int, mixed> $values */
    private function write($output, array $values): void
    {
        $safe = array_map(static function ($value) {
            if (is_string($value) && preg_match('/^[\s\x00-\x1F]*[=+\-@]/u', $value)) {
                return "'".$value;
            }

            return $value;
        }, $values);
        fputcsv($output, $safe, ',', '"', '');
    }
}
