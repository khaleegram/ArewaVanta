<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

final class PlayerRankingsController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $players = DB::table('revision_player_results as player_results')
            ->join('players', 'players.id', '=', 'player_results.player_id')
            ->join('match_result_revisions as revisions', 'revisions.id', '=', 'player_results.revision_id')
            ->join('match_squad_results as squad_results', 'squad_results.id', '=', 'player_results.match_squad_result_id')
            ->join('matches', 'matches.id', '=', 'revisions.match_id')
            ->join('event_days', 'event_days.id', '=', 'matches.event_day_id')
            ->join('events', 'events.id', '=', 'event_days.event_id')
            ->whereColumn('matches.current_published_revision_id', 'revisions.id')
            ->where('revisions.status', 'published')->where('squad_results.participation_status', 'present')
            ->whereNotNull('player_results.kills')
            ->where('events.visibility', 'public')->whereNull('events.deleted_at')->whereNull('event_days.deleted_at')->whereNull('matches.deleted_at')
            ->groupBy('players.id', 'players.current_ign')
            ->selectRaw('players.id, players.current_ign, COUNT(*) AS appearances, SUM(player_results.kills) AS total_kills, MAX(player_results.kills) AS best_game_kills, RANK() OVER (ORDER BY SUM(player_results.kills) DESC) AS rank')
            ->orderByDesc('total_kills')->orderBy('players.id')->paginate(20);

        return response()->json([
            'data' => $players->getCollection()->map(static fn ($player): array => [
                'id' => $player->id, 'ign' => $player->current_ign, 'appearances' => (int) $player->appearances,
                'total_kills' => (int) $player->total_kills, 'rank' => (int) $player->rank,
                'best_game_kills' => (int) $player->best_game_kills,
            ])->values(),
            'meta' => ['current_page' => $players->currentPage(), 'last_page' => $players->lastPage(), 'total' => $players->total()],
        ]);
    }
}
