<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ResultPermissions;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Http\Controllers\Controller;
use App\Models\CompetitionEvent;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class CompetitionOrganizerController extends Controller
{
    public function __invoke(Request $request, CompetitionEvent $event, ResultPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManage($request->user(), $event), 403);

        $eventIds = $event->series_id === null
            ? [$event->id]
            : CompetitionEvent::query()->where('series_id', $event->series_id)->pluck('id')->all();
        $members = User::query()->with('roleAssignments')
            ->whereHas('roleAssignments', function ($query) use ($eventIds): void {
                $query->where(function ($query) use ($eventIds): void {
                    $query->where('role', Role::Organizer->value)
                        ->where('scope_type', RoleScope::Event->value)->whereIn('scope_id', $eventIds);
                })->orWhere(function ($query): void {
                    $query->whereIn('role', [Role::Organizer->value, Role::PlatformAdmin->value])
                        ->where('scope_type', RoleScope::Global->value)->where('scope_id', '*');
                });
            })->orderBy('name')->get();
        $memberEmails = $members->map(fn (User $member): string => Str::lower($member->email));
        $invitations = DB::table('event_organizer_invitations')->whereIn('event_id', $eventIds)
            ->whereNull('accepted_at')->orderByDesc('created_at')->orderByDesc('id')->get()
            ->unique('email')->reject(fn (object $invitation): bool => $memberEmails->contains(Str::lower($invitation->email)))
            ->map(static fn (object $invitation): array => [
                'id' => $invitation->id,
                'email' => $invitation->email,
                'sent_at' => CarbonImmutable::parse($invitation->created_at)->toIso8601String(),
                'status' => 'pending',
            ])->values();

        return response()->json(['data' => [
            'event' => ['id' => $event->id, 'title' => $event->title, 'series_id' => $event->series_id],
            'members' => $members->map(static function (User $member): array {
                $global = $member->roleAssignments->contains(fn ($role): bool =>
                    in_array($role->role, [Role::Organizer->value, Role::PlatformAdmin->value], true)
                    && $role->scope_type === RoleScope::Global->value && $role->scope_id === '*');

                return ['id' => $member->id, 'name' => $member->name, 'email' => $member->email, 'access' => $global ? 'global' : 'competition'];
            })->values(),
            'invitations' => $invitations,
        ]])->header('Cache-Control', 'no-store');
    }
}
