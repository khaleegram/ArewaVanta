<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\OrganizationPermissions;
use App\Domain\Notifications\AdminActivity;
use App\Http\Controllers\Controller;
use App\Models\Clan;
use App\Models\Player;
use App\Models\Squad;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class DirectoryController extends Controller
{
    public function updateClan(Request $request, Clan $clan, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageClan($request->user(), $clan), 403);
        if (is_string($request->input('name'))) {
            $request->merge(['name' => trim($request->input('name'))]);
        }
        if (is_string($request->input('tag'))) {
            $request->merge(['tag' => Str::upper(trim($request->input('tag')))]);
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120', function (string $attribute, mixed $value, \Closure $fail) use ($clan): void {
                if (Clan::query()->whereKeyNot($clan->id)->whereRaw('LOWER(name) = ?', [Str::lower($value)])->exists()) {
                    $fail('A clan with this name already exists.');
                }
            }],
            'tag' => ['required', 'string', 'max:16', Rule::unique('clans', 'tag')->ignore($clan->id)],
            'bio' => ['nullable', 'string', 'max:2000'],
        ]);
        $clan->fill($data)->save();
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' updated '.$clan->name.'.');

        return response()->json(['data' => ['id' => $clan->id, 'name' => $clan->name, 'slug' => $clan->slug, 'tag' => $clan->tag, 'bio' => $clan->bio]]);
    }

    public function updateSquad(Request $request, Squad $squad, OrganizationPermissions $permissions): JsonResponse
    {
        $squad->load('clan');
        abort_unless($permissions->canManageClan($request->user(), $squad->clan), 403);
        if (is_string($request->input('tag'))) {
            $tag = Str::upper(trim($request->input('tag')));
            $request->merge(['tag' => $tag === '' ? null : $tag]);
        }
        $data = $request->validate([
            'name' => ['prohibited'],
            'squad_number' => ['prohibited'],
            'tag' => ['nullable', 'string', 'max:16'],
        ]);
        $squad->fill($data)->save();
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' updated '.$squad->name.'.');

        return response()->json(['data' => [
            'id' => $squad->id, 'clan_id' => $squad->clan_id, 'name' => $squad->name,
            'squad_number' => $squad->squad_number, 'slug' => $squad->slug, 'tag' => $squad->tag,
        ]]);
    }

    public function showPlayer(Request $request, Player $player, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);

        return response()->json(['data' => $this->playerData($player)]);
    }

    public function storePlayer(Request $request, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);
        $data = $this->validatedPlayer($request);
        $player = Player::query()->create($data + ['status' => 'active']);
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' registered player '.$player->current_ign.'.');

        return response()->json(['data' => $this->playerData($player)], 201);
    }

    public function updatePlayer(Request $request, Player $player, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);
        $player = DB::transaction(function () use ($request, $player): Player {
            $player = Player::query()->lockForUpdate()->findOrFail($player->id);
            $data = $this->validatedPlayer($request, $player);
            if ($data['clan_id'] !== $player->clan_id && $player->squadMemberships()->whereNull('left_at')->exists()) {
                throw ValidationException::withMessages(['clan_id' => 'Remove this player from their current squads before changing clans.']);
            }
            $player->fill($data)->save();

            return $player;
        });
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' updated player '.$player->current_ign.'.');

        return response()->json(['data' => $this->playerData($player)]);
    }

    private function validatedPlayer(Request $request, ?Player $player = null): array
    {
        $uid = $request->exists('uid') ? $request->input('uid') : $player?->normalized_uid;
        $uid = is_string($uid) ? Str::upper(preg_replace('/\s+/u', '', trim($uid))) : $uid;
        if (is_string($request->input('current_ign'))) {
            $request->merge(['current_ign' => trim($request->input('current_ign'))]);
        }
        $request->merge(['uid' => $uid === '' ? null : $uid]);
        $data = $request->validate([
            'current_ign' => ['required', 'string', 'max:100'],
            'clan_id' => ['sometimes', 'nullable', 'ulid', Rule::exists('clans', 'id')],
            'uid' => ['nullable', 'bail', 'string', 'max:64', Rule::unique('players', 'normalized_uid')->ignore($player?->id)],
            'uid_public' => ['sometimes', 'boolean'],
        ]);

        return ['clan_id' => $request->exists('clan_id') ? ($data['clan_id'] ?? null) : $player?->clan_id,
            'current_ign' => $data['current_ign'], 'normalized_uid' => $data['uid'] ?? null, 'uid_public' => $data['uid_public'] ?? ($player?->uid_public ?? false)];
    }

    private function playerData(Player $player): array
    {
        return ['id' => $player->id, 'clan_id' => $player->clan_id, 'current_ign' => $player->current_ign, 'uid' => $player->normalized_uid, 'uid_public' => $player->uid_public];
    }
}
