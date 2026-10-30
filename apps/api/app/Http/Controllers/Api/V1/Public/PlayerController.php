<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Http\Controllers\Controller;
use App\Models\Player;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class PlayerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate(['search' => ['sometimes', 'nullable', 'string', 'max:100']]);
        $search = Str::lower($filters['search'] ?? '');
        $players = Player::query()->where('status', 'active')
            ->when($search !== '', fn ($query) => $query->whereRaw('LOWER(current_ign) LIKE ?', ['%'.$search.'%']))
            ->orderBy('current_ign')->orderBy('id')->paginate(20, ['id', 'current_ign']);

        return response()->json([
            'data' => $players->items(),
            'meta' => ['current_page' => $players->currentPage(), 'last_page' => $players->lastPage(), 'total' => $players->total()],
        ]);
    }

    public function show(Player $player): JsonResponse
    {
        $player->load(['squadMemberships' => fn ($query) => $query->whereNull('left_at')->with('squad.clan')]);
        $publishedResults = DB::table('revision_player_results as player_results')
            ->join('match_result_revisions as revisions', 'revisions.id', '=', 'player_results.revision_id')
            ->join('match_squad_results as squad_results', 'squad_results.id', '=', 'player_results.match_squad_result_id')
            ->join('matches', 'matches.id', '=', 'revisions.match_id')
            ->join('event_days', 'event_days.id', '=', 'matches.event_day_id')
            ->join('events', 'events.id', '=', 'event_days.event_id')
            ->whereColumn('matches.current_published_revision_id', 'revisions.id')
            ->where('revisions.status', 'published')
            ->where('squad_results.participation_status', 'present')
            ->where('player_results.player_id', $player->id)
            ->where('events.visibility', 'public')
            ->whereNull('events.deleted_at')
            ->whereNull('event_days.deleted_at')
            ->whereNull('matches.deleted_at');

        $totals = (clone $publishedResults)
            ->selectRaw('COUNT(*) AS appearances, COALESCE(SUM(player_results.kills), 0) AS total_kills, MAX(player_results.kills) AS best_game')
            ->first();
        $appearances = (int) $totals->appearances;
        $kills = (int) $totals->total_kills;
        $history = (clone $publishedResults)
            ->select([
                'player_results.ign_snapshot', 'player_results.kills', 'matches.id as match_id',
                'matches.match_index', 'matches.map_label', 'event_days.event_date',
                'events.title as event_title', 'events.slug as event_slug',
                'squad_results.squad_id', 'squad_results.squad_name_snapshot',
            ])
            ->orderByDesc('event_days.event_date')->orderByDesc('matches.match_index')
            ->paginate(20);

        return response()->json(['data' => [
            'id' => $player->id,
            'current_ign' => $player->current_ign,
            'current_squads' => $player->squadMemberships->map(static fn ($membership): array => [
                'id' => $membership->squad->id,
                'name' => $membership->squad->name,
                'slug' => $membership->squad->slug,
                'clan' => ['name' => $membership->squad->clan->name, 'slug' => $membership->squad->clan->slug],
            ])->values(),
            'uid' => $player->uid_public ? $player->normalized_uid : null,
            'appearances' => $appearances,
            'total_kills' => $kills,
            'kills_per_appearance' => $appearances === 0 ? null : (string) BigDecimal::of($kills)->dividedBy($appearances, 2, RoundingMode::HalfUp),
            'best_game_kills' => $totals->best_game === null ? null : (int) $totals->best_game,
            'match_history' => $history->items(),
            'history_meta' => ['current_page' => $history->currentPage(), 'last_page' => $history->lastPage(), 'total' => $history->total()],
        ]]);
    }
}
