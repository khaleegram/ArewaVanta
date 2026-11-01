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
        ]);
        // Only authorized scorekeepers can search across clans for actual participants.
        $players = Player::query()->with('clan:id,name,tag')->where('status', 'active')
            ->when(filled($data['clan_id'] ?? null), fn ($query) => $query->where('clan_id', $data['clan_id']))
            ->orderBy('current_ign')->get();
        if (filled($data['search'] ?? null)) {
            $players = $players->filter(fn ($player): bool => PlayerNameSearch::matches($player->current_ign, $data['search']));
        }

        return response()->json(['data' => $players->take(40)->map(fn ($player): array => [
            'id' => $player->id, 'ign' => $player->current_ign,
            'clan' => $player->clan?->name, 'clan_id' => $player->clan_id,
        ])->values(), 'meta' => ['has_more' => $players->count() > 40]])->header('Cache-Control', 'private, no-store');
    }
}
