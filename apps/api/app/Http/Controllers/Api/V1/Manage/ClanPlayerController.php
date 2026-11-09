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
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
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

    public function update(Request $request, Clan $clan, Player $player, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageClan($request->user(), $clan), 403);
        abort_unless(
            $player->clan_id === $clan->id,
            404,
            'That player is no longer in this clan. Refresh the player list and try again.',
        );
        if (is_string($request->input('current_ign'))) {
            $request->merge(['current_ign' => trim($request->input('current_ign'))]);
        }
        if (is_string($request->input('uid'))) {
            $uid = Str::upper(preg_replace('/\s+/u', '', trim($request->input('uid'))));
            $request->merge(['uid' => $uid === '' ? null : $uid]);
        }
        $data = $request->validate([
            'current_ign' => ['required', 'string', 'max:100'],
            'uid' => ['sometimes', 'nullable', 'string', 'max:64', Rule::unique('players', 'normalized_uid')->ignore($player->id)],
        ]);
        $player = DB::transaction(function () use ($request, $player, $data): Player {
            $player = Player::query()->lockForUpdate()->findOrFail($player->id);
            $player->current_ign = $data['current_ign'];
            if ($request->exists('uid')) {
                $player->normalized_uid = $data['uid'] ?? null;
            }
            $player->save();

            return $player;
        });
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' updated '.$player->current_ign.' in '.$clan->name.'.');

        return response()->json(['data' => ['id' => $player->id, 'current_ign' => $player->current_ign, 'squads' => []]]);
    }

    public function destroy(Request $request, Clan $clan, Player $player, OrganizationPermissions $permissions): Response
    {
        abort_unless($permissions->canManageClan($request->user(), $clan), 403);
        abort_unless(
            $player->clan_id === $clan->id,
            404,
            'That player is no longer in this clan. Refresh the player list and try again.',
        );
        DB::transaction(function () use ($player): void {
            $player = Player::query()->lockForUpdate()->findOrFail($player->id);
            $player->squadMemberships()->whereNull('left_at')->update(['left_at' => now()]);
            // Keep the profile and its historical results; remove it from the active clan pool.
            $player->forceFill(['status' => 'inactive', 'clan_id' => null])->save();
        });
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' removed '.$player->current_ign.' from '.$clan->name.'.');

        return response()->noContent();
    }
}
