<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Notifications\AdminActivity;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\RoleAssignment;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class PeopleController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()->isPlatformAdmin(), 403);
        $filters = $request->validate(['search' => ['sometimes', 'nullable', 'string', 'max:100']]);
        $term = isset($filters['search']) ? Str::lower(trim($filters['search'])) : '';
        $users = User::query()->with('roleAssignments')
            ->when($term !== '', fn ($query) => $query->where(fn ($query) => $query
                ->whereRaw('LOWER(name) LIKE ?', ['%'.$term.'%'])
                ->orWhereRaw('LOWER(email) LIKE ?', ['%'.$term.'%'])))
            ->orderBy('name')->paginate(20);

        return response()->json([
            'data' => $users->getCollection()->map(static fn (User $user): array => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'roles' => $user->roleAssignments->whereIn('role', ['platform_admin', 'organizer', 'clan_captain'])->map(static fn (RoleAssignment $role): array => [
                    'id' => $role->id, 'role' => $role->role, 'scope_type' => $role->scope_type, 'scope_id' => $role->scope_id,
                ])->values(),
            ])->values(),
            'meta' => ['current_page' => $users->currentPage(), 'last_page' => $users->lastPage(), 'total' => $users->total()],
        ]);
    }

    public function assign(Request $request, User $user): JsonResponse
    {
        abort_unless($request->user()->isPlatformAdmin(), 403);
        $data = $request->validate([
            'role' => ['required', Rule::enum(Role::class)],
            'scope_type' => ['required', Rule::enum(RoleScope::class)],
            'scope_id' => ['required', 'string', 'max:26'],
        ]);
        $allowedScopes = match (Role::from($data['role'])) {
            Role::PlatformAdmin => [RoleScope::Global->value],
            Role::Organizer => [RoleScope::Global->value, RoleScope::Event->value],
            Role::ClanCaptain => [RoleScope::Clan->value],
        };
        if (! in_array($data['scope_type'], $allowedScopes, true)) {
            throw ValidationException::withMessages(['scope_type' => 'This role cannot be assigned at that scope.']);
        }
        $scopeExists = match ($data['scope_type']) {
            RoleScope::Global->value => $data['scope_id'] === '*',
            RoleScope::Event->value => CompetitionEvent::query()->whereKey($data['scope_id'])->exists(),
            RoleScope::Clan->value => Clan::query()->whereKey($data['scope_id'])->exists(),
        };
        if (! $scopeExists) {
            throw ValidationException::withMessages(['scope_id' => 'Choose an existing scope, or * for a global assignment.']);
        }

        $assignment = DB::transaction(function () use ($request, $user, $data): RoleAssignment {
            $assignment = RoleAssignment::query()->firstOrCreate(
                ['user_id' => $user->id, 'role' => $data['role'], 'scope_type' => $data['scope_type'], 'scope_id' => $data['scope_id']],
                ['assigned_by' => $request->user()->id],
            );
            if ($assignment->wasRecentlyCreated) {
                $this->audit($request->user(), $user, 'role_assigned', null, $data);
                if ($data['role'] === Role::ClanCaptain->value) {
                    app(AdminActivity::class)->record($request->user(), $request->user()->name.' assigned '.$user->name.' as a clan captain.');
                }
            }

            return $assignment;
        });

        return response()->json(['data' => [
            'id' => $assignment->id, 'user_id' => $user->id, 'role' => $assignment->role,
            'scope_type' => $assignment->scope_type, 'scope_id' => $assignment->scope_id,
        ]], $assignment->wasRecentlyCreated ? 201 : 200);
    }

    public function revoke(Request $request, User $user, RoleAssignment $assignment): JsonResponse
    {
        abort_unless($request->user()->isPlatformAdmin(), 403);
        abort_unless($assignment->user_id === $user->id, 404);

        DB::transaction(function () use ($request, $user, $assignment): void {
            if ($assignment->role === Role::PlatformAdmin->value && $assignment->scope_type === RoleScope::Global->value && $assignment->scope_id === '*') {
                $admins = RoleAssignment::query()->where('role', Role::PlatformAdmin->value)
                    ->where('scope_type', RoleScope::Global->value)->where('scope_id', '*')
                    ->orderBy('id')->lockForUpdate()->get();
                if ($admins->count() <= 1) {
                    throw ValidationException::withMessages(['role' => 'The last platform administrator cannot be removed.']);
                }
            }
            $assignment = RoleAssignment::query()->where('user_id', $user->id)->lockForUpdate()->findOrFail($assignment->id);
            $before = $assignment->only(['role', 'scope_type', 'scope_id']);
            $assignment->delete();
            $this->audit($request->user(), $user, 'role_revoked', $before, null);
            if ($before['role'] === Role::ClanCaptain->value) {
                app(AdminActivity::class)->record($request->user(), $request->user()->name.' removed '.$user->name.' as a clan captain.');
            }
        });

        return response()->json(status: 204);
    }

    /** @param array<string, mixed>|null $before @param array<string, mixed>|null $after */
    private function audit(User $actor, User $subject, string $action, ?array $before, ?array $after): void
    {
        AuditLog::query()->create([
            'actor_user_id' => $actor->id,
            'action' => $action,
            'entity_type' => 'user',
            'entity_id' => (string) $subject->id,
            'before_data' => $before,
            'after_data' => $after,
            'occurred_at' => now(),
        ]);
    }
}
