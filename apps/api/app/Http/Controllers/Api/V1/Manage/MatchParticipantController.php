<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\PlayerNameSearch;
use App\Domain\Competition\ResultPermissions;
use App\Http\Controllers\Controller;
use App\Models\CompetitionMatch;
use App\Models\Player;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MatchParticipantController extends Controller
{
    public function __invoke(Request $request, CompetitionMatch $match, ResultPermissions $permissions): JsonResponse
    {
        $match->load('day.event');
        abort_unless($permissions->canManage($request->user(), $match->day->event), 403);
        $data = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'clan_id' => ['sometimes', 'nullable', 'ulid'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:10000'],
        ]);
        // Only authorized scorekeepers can search across clans for actual participants.
        $players = Player::query()->with('clan:id,name,tag,tags')->where('status', 'active')
            ->when(filled($data['clan_id'] ?? null), fn ($query) => $query->where('clan_id', $data['clan_id']))
            ->orderBy('current_ign')->get();
        if (filled($data['search'] ?? null)) {
            $search = PlayerNameSearch::key($data['search']);
            $players = $players->filter(fn ($player): bool => PlayerNameSearch::matches($player->current_ign, $data['search']))
                ->map(function ($player) use ($search): Player {
                    $key = PlayerNameSearch::key($player->current_ign);
                    $player->setAttribute('search_rank', $key === $search ? 2 : (str_starts_with($key, $search) ? 1 : 0));

                    return $player;
                })
                ->sortBy([['search_rank', 'desc'], ['current_ign', 'asc']])
                ->values();
        }
        $page = (int) ($data['page'] ?? 1);
        $perPage = 100;
        $total = $players->count();
        $matches = $players->forPage($page, $perPage)->values();

        return response()->json(['data' => $matches->map(fn ($player): array => [
            'id' => $player->id, 'ign' => $player->current_ign,
            'clan' => $player->clan?->name, 'clan_id' => $player->clan_id,
            'clan_tag' => $player->clan?->tag, 'clan_tags' => $player->clan?->tagList() ?? [],
        ]), 'meta' => [
            'has_more' => $page * $perPage < $total,
            'page' => $page,
            'per_page' => $perPage,
            'total' => $total,
        ]])->header('Cache-Control', 'private, no-store');
    }
}
