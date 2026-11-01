<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\OrganizationPermissions;
use App\Domain\Notifications\AdminActivity;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Clan;
use App\Models\Player;
use App\Models\RoleAssignment;
use App\Models\Squad;
use App\Models\SquadMembership;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class OrganizationController extends Controller
{
    public function index(Request $request, OrganizationPermissions $permissions): JsonResponse
    {
        $user = $request->user();
        $clanIds = $user->roleAssignments()->where('role', Role::ClanCaptain->value)
            ->where('scope_type', RoleScope::Clan->value)->pluck('scope_id');
        $clans = Clan::query()->with('squads')
            ->when(! $permissions->canManageAnyClan($user), fn ($query) => $query->whereIn('id', $clanIds))
            ->orderBy('name')->paginate(20);

        return response()->json([
            'data' => $clans->getCollection()->map(static fn (Clan $clan): array => [
                'id' => $clan->id,
                'name' => $clan->name,
                'slug' => $clan->slug,
                'tag' => $clan->tag,
                'squad_count' => $clan->squads->count(),
                'squads' => $clan->squads->map(static fn (Squad $squad): array => [
                    'id' => $squad->id, 'name' => $squad->name, 'squad_number' => $squad->squad_number,
                    'slug' => $squad->slug, 'tag' => $squad->tag,
                ])->values(),
            ])->values(),
            'meta' => ['current_page' => $clans->currentPage(), 'last_page' => $clans->lastPage(), 'total' => $clans->total()],
        ]);
    }

    public function registerClan(Request $request): JsonResponse
    {
        if (is_string($request->input('name'))) {
            $request->merge(['name' => trim($request->input('name'))]);
        }
        if (is_string($request->input('tag'))) {
            $request->merge(['tag' => Str::upper(trim($request->input('tag')))]);
        }
        $data = $request->validate([
            'name' => ['bail', 'required', 'string', 'max:120', function (string $attribute, mixed $value, \Closure $fail): void {
                if (Clan::query()->whereRaw('LOWER(name) = ?', [Str::lower($value)])->exists()) {
                    $fail('A clan with this name already exists.');
                }
            }],
            'tag' => ['required', 'string', 'max:16', Rule::unique('clans', 'tag')],
            'bio' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $clan = DB::transaction(function () use ($request, $data): Clan {
            $id = (string) Str::ulid();
            $clan = new Clan([
                'name' => $data['name'],
                'tag' => $data['tag'],
                'bio' => $data['bio'] ?? null,
                'slug' => $this->slug($data['name'], $id),
                'status' => 'active',
                'created_by' => $request->user()->id,
            ]);
            $clan->id = $id;
            $clan->save();
            RoleAssignment::query()->create([
                'user_id' => $request->user()->id,
                'role' => Role::ClanCaptain->value,
                'scope_type' => RoleScope::Clan->value,
                'scope_id' => $clan->id,
                'assigned_by' => $request->user()->id,
            ]);
            $this->audit($request->user()->id, 'clan_registered', 'clan', $clan->id, null, ['name' => $clan->name, 'tag' => $clan->tag, 'status' => 'active']);

            return $clan;
        });

        return response()->json(['data' => ['id' => $clan->id, 'name' => $clan->name, 'slug' => $clan->slug, 'tag' => $clan->tag]], 201);
    }

    public function createSquad(Request $request, Clan $clan, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageClan($request->user(), $clan), 403);
        $data = $request->validate([
            'name' => ['prohibited'],
            'squad_number' => ['prohibited'],
            'tag' => ['sometimes', 'nullable', 'string', 'max:16'],
        ]);
        $squad = DB::transaction(function () use ($request, $clan, $data): Squad {
            $clan = Clan::query()->lockForUpdate()->findOrFail($clan->id);
            $number = ((int) $clan->squads()->max('squad_number')) + 1;
            $name = 'Squad '.$number;
            $id = (string) Str::ulid();
            $squad = new Squad([
                'clan_id' => $clan->id,
                'name' => $name,
                'squad_number' => $number,
                'slug' => $this->slug($name, $id),
                'tag' => isset($data['tag']) ? Str::upper(trim($data['tag'])) : null,
                'status' => 'active',
                'captain_user_id' => $request->user()->id,
            ]);
            $squad->id = $id;
            $squad->save();
            $this->audit($request->user()->id, 'squad_registered', 'squad', $squad->id, null, [
                'clan_id' => $clan->id, 'clan_tag' => $clan->tag, 'name' => $squad->name,
                'squad_number' => $squad->squad_number, 'status' => 'active',
            ]);

            return $squad;
        });

        return response()->json(['data' => [
            'id' => $squad->id, 'clan_id' => $clan->id, 'name' => $squad->name,
            'squad_number' => $squad->squad_number, 'slug' => $squad->slug, 'tag' => $squad->tag,
        ]], 201);
    }

    public function roster(Request $request, Squad $squad, OrganizationPermissions $permissions): JsonResponse
    {
        $squad->load('clan');
        abort_unless($permissions->canManageClan($request->user(), $squad->clan), 403);
        $memberships = $squad->memberships()->with('player')->whereNull('left_at')->orderBy('joined_at')->get();

        return response()->json(['data' => $memberships->map(static fn (SquadMembership $membership): array => [
            'membership_id' => $membership->id,
            'player_id' => $membership->player_id,
            'ign' => $membership->player->current_ign,
            'joined_at' => $membership->joined_at,
        ])->values()]);
    }

    public function addRosterPlayer(Request $request, Squad $squad, OrganizationPermissions $permissions): JsonResponse
    {
        $squad->load('clan');
        abort_unless($permissions->canManageClan($request->user(), $squad->clan), 403);
        if (is_string($request->input('current_ign'))) {
            $request->merge(['current_ign' => trim($request->input('current_ign'))]);
        }
        $data = $request->validate([
            'player_id' => ['nullable', 'required_without:current_ign', 'prohibits:current_ign,uid', 'ulid', Rule::exists('players', 'id')],
            'current_ign' => ['nullable', 'required_without:player_id', 'prohibits:player_id', 'string', 'max:100'],
            'uid' => ['sometimes', 'nullable', 'prohibits:player_id', 'string', 'max:64'],
            'joined_at' => ['sometimes', 'required', 'date', 'before_or_equal:now'],
        ]);

        $membership = DB::transaction(function () use ($request, $squad, $data): SquadMembership {
            $squad = Squad::query()->lockForUpdate()->findOrFail($squad->id);
            if (isset($data['player_id'])) {
                $player = Player::query()->where('status', 'active')->findOrFail($data['player_id']);
            } else {
                $uid = isset($data['uid']) ? Str::upper(preg_replace('/\s+/u', '', trim($data['uid']))) : null;
                if ($uid === '' || ($uid !== null && mb_strlen($uid) > 64)) {
                    throw ValidationException::withMessages(['uid' => 'Enter a valid UID of at most 64 characters.']);
                }
                if ($uid !== null && Player::query()->where('normalized_uid', $uid)->exists()) {
                    throw ValidationException::withMessages(['uid' => 'This UID already belongs to a player. Add that existing player instead.']);
                }
                $player = Player::query()->create(['current_ign' => trim($data['current_ign']), 'normalized_uid' => $uid, 'status' => 'active']);
            }

            if ($squad->memberships()->where('player_id', $player->id)->whereNull('left_at')->exists()) {
                throw ValidationException::withMessages(['player_id' => 'This player is already in the squad.']);
            }
            $membership = SquadMembership::query()->create([
                'squad_id' => $squad->id,
                'player_id' => $player->id,
                'joined_at' => isset($data['joined_at']) ? CarbonImmutable::parse($data['joined_at'])->utc() : now(),
            ]);
            $this->audit($request->user()->id, 'roster_player_added', 'squad', $squad->id, null, [
                'player_id' => $player->id, 'ign' => $player->current_ign, 'joined_at' => $membership->joined_at->toIso8601String(),
            ]);

            return $membership->load('player');
        });

        return response()->json(['data' => [
            'membership_id' => $membership->id,
            'player_id' => $membership->player_id,
            'ign' => $membership->player->current_ign,
            'joined_at' => $membership->joined_at,
        ]], 201);
    }

    public function removeRosterPlayer(Request $request, Squad $squad, Player $player, OrganizationPermissions $permissions): JsonResponse
    {
        $squad->load('clan');
        abort_unless($permissions->canManageClan($request->user(), $squad->clan), 403);

        DB::transaction(function () use ($request, $squad, $player): void {
            $squad = Squad::query()->lockForUpdate()->findOrFail($squad->id);
            $membership = $squad->memberships()->where('player_id', $player->id)->whereNull('left_at')->firstOrFail();
            $membership->left_at = now();
            $membership->save();
            $this->audit($request->user()->id, 'roster_player_removed', 'squad', $squad->id, ['player_id' => $player->id], [
                'player_id' => $player->id, 'left_at' => $membership->left_at->toIso8601String(),
            ]);
        });

        return response()->json(status: 204);
    }

    private function slug(string $name, string $id): string
    {
        return (Str::slug($name) ?: 'arewavanta').'-'.Str::lower(substr($id, -8));
    }

    /** @param array<string, mixed>|null $before @param array<string, mixed> $after */
    private function audit(int $actorId, string $action, string $entityType, string $entityId, ?array $before, array $after): void
    {
        AuditLog::query()->create([
            'actor_user_id' => $actorId,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'before_data' => $before,
            'after_data' => $after,
            'occurred_at' => now(),
        ]);
        $actor = User::query()->find($actorId);
        if ($actor && in_array($action, ['clan_registered', 'squad_registered', 'roster_player_added', 'roster_player_removed'], true)) {
            $description = match ($action) {
                'clan_registered' => 'created clan '.($after['name'] ?? ''),
                'squad_registered' => 'created squad '.($after['name'] ?? ''),
                'roster_player_added' => 'added '.($after['ign'] ?? 'a player').' to '.(Squad::query()->find($entityId)?->name ?? 'a squad'),
                'roster_player_removed' => 'removed a player from '.(Squad::query()->find($entityId)?->name ?? 'a squad'),
            };
            app(AdminActivity::class)->record($actor, $actor->name.' '.$description.'.');
        }
    }
}
