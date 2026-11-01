<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\OrganizationPermissions;
use App\Domain\Competition\PlayerNameSearch;
use App\Domain\Notifications\AdminActivity;
use App\Http\Controllers\Controller;
use App\Models\Clan;
use App\Models\Player;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class ClanPlayerController extends Controller
{
    public function index(Request $request, Clan $clan, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageClan($request->user(), $clan), 403);
        $data = $request->validate(['search' => ['sometimes', 'nullable', 'string', 'max:100']]);
        $players = $clan->players()->where('status', 'active')
            ->with(['squadMemberships' => fn ($query) => $query->whereNull('left_at')
                ->whereHas('squad', fn ($query) => $query->where('clan_id', $clan->id))->with('squad')])
            ->orderBy('current_ign')->get();
        if (filled($data['search'] ?? null)) {
            $players = $players->filter(fn (Player $player): bool => PlayerNameSearch::matches($player->current_ign, $data['search']));
        }

        return response()->json(['data' => $players->map(fn (Player $player): array => [
            'id' => $player->id,
            'current_ign' => $player->current_ign,
            'squads' => $player->squadMemberships->map(fn ($membership): array => [
                'id' => $membership->squad->id, 'name' => $membership->squad->name,
            ])->unique('id')->values(),
        ])->values()]);
    }

    public function store(Request $request, Clan $clan, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageClan($request->user(), $clan), 403);
        if (is_string($request->input('current_ign'))) {
            $request->merge(['current_ign' => trim($request->input('current_ign'))]);
        }
        if (is_string($request->input('uid'))) {
            $uid = Str::upper(preg_replace('/\s+/u', '', trim($request->input('uid'))));
            $request->merge(['uid' => $uid === '' ? null : $uid]);
        }
        $data = $request->validate([
            'current_ign' => ['required', 'string', 'max:100'],
            'uid' => ['sometimes', 'nullable', 'string', 'max:64', Rule::unique('players', 'normalized_uid')],
        ]);
        $player = Player::query()->create([
            'clan_id' => $clan->id, 'current_ign' => $data['current_ign'],
            'normalized_uid' => $data['uid'] ?? null, 'status' => 'active',
        ]);
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' added '.$player->current_ign.' to '.$clan->name.'.');

        return response()->json(['data' => ['id' => $player->id, 'current_ign' => $player->current_ign, 'squads' => []]], 201);
    }
}
