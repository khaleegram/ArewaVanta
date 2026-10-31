<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ResultPermissions;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Http\Controllers\Controller;
use App\Mail\CompetitionOrganizerInvitation;
use App\Models\CompetitionEvent;
use App\Models\RoleAssignment;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

final class CompetitionOrganizerInvitationController extends Controller
{
    public function send(Request $request, CompetitionEvent $event, ResultPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManage($request->user(), $event), 403);
        if (in_array(config('mail.default'), ['log', 'array'], true)) {
            return response()->json(['message' => 'Email delivery is not configured. Configure a mail service before sending invitations.'], 503);
        }
        $data = $request->validate(['email' => ['required', 'email', 'max:255']]);
        $email = Str::lower(trim($data['email']));
        $existing = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();
        $seriesEventIds = $event->series_id === null
            ? [$event->id]
            : CompetitionEvent::query()->where('series_id', $event->series_id)->pluck('id')->all();
        if ($existing?->hasRole(Role::Organizer, RoleScope::Global, '*') || $existing?->isPlatformAdmin()
            || ($existing !== null && RoleAssignment::query()->where('user_id', $existing->id)
                ->where('role', Role::Organizer->value)
                ->where('scope_type', RoleScope::Event->value)
                ->whereIn('scope_id', $seriesEventIds)->exists())) {
            throw ValidationException::withMessages(['email' => 'This account already has access to the competition.']);
        }

        $token = bin2hex(random_bytes(32));
        $url = rtrim((string) config('app.frontend_url'), '/').'/competition-organizer-invite#'.urlencode($token);
        try {
            DB::transaction(function () use ($event, $request, $email, $token, $url): void {
                DB::table('event_organizer_invitations')->where('event_id', $event->id)->where('email', $email)->whereNull('accepted_at')->delete();
                DB::table('event_organizer_invitations')->insert([
                    'event_id' => $event->id, 'email' => $email, 'token_hash' => hash('sha256', $token),
                    'invited_by' => $request->user()->id, 'expires_at' => now()->addDays(7),
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                Mail::to($email)->send(new CompetitionOrganizerInvitation($event->title, $url));
            });
        } catch (\Throwable $error) {
            report($error);

            return response()->json(['message' => 'Could not send the invitation. Check the mail configuration and try again.'], 503);
        }

        return response()->json(['message' => 'Organizer invitation sent.'], 201);
    }

    public function inspect(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'size:64']]);
        $invitation = $this->find($data['token']);
        $event = CompetitionEvent::query()->findOrFail($invitation->event_id);
        $existing = User::query()->whereRaw('LOWER(email) = ?', [$invitation->email])->exists();

        return response()->json(['data' => ['event_id' => $event->id, 'competition' => $event->title, 'email' => $invitation->email, 'existing_account' => $existing]])->header('Cache-Control', 'no-store');
    }

    public function accept(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'size:64'], 'name' => ['sometimes', 'string', 'max:255'],
            'password' => ['required', 'string', 'max:255'], 'password_confirmation' => ['sometimes', 'string', 'max:255'],
        ]);
        $user = DB::transaction(function () use ($data): User {
            $invitation = $this->find($data['token'], true);
            $event = CompetitionEvent::query()->findOrFail($invitation->event_id);
            $eventIds = $event->series_id === null
                ? [$event->id]
                : CompetitionEvent::query()->where('series_id', $event->series_id)->pluck('id')->all();
            $user = User::query()->whereRaw('LOWER(email) = ?', [$invitation->email])->first();
            if ($user) {
                if (! Hash::check($data['password'], $user->password)) {
                    throw ValidationException::withMessages(['password' => 'The supplied password is incorrect.']);
                }
            } else {
                validator($data, ['name' => ['required', 'string', 'max:255'], 'password' => ['required', 'confirmed', Password::min(12)]])->validate();
                $user = User::query()->create(['name' => trim($data['name']), 'email' => $invitation->email, 'password' => $data['password']]);
                $user->forceFill(['email_verified_at' => now()])->save();
            }
            foreach ($eventIds as $eventId) {
                RoleAssignment::query()->firstOrCreate(
                    ['user_id' => $user->id, 'role' => Role::Organizer->value, 'scope_type' => RoleScope::Event->value, 'scope_id' => $eventId],
                    ['assigned_by' => $invitation->invited_by],
                );
            }
            DB::table('event_organizer_invitations')->where('id', $invitation->id)->update(['accepted_at' => now(), 'updated_at' => now()]);

            return $user;
        });

        return response()->json(['data' => ['token' => $user->createToken('arewavanta-web', ['*'], now()->addDays(30))->plainTextToken]])->header('Cache-Control', 'no-store');
    }

    private function find(string $token, bool $lock = false): object
    {
        $query = DB::table('event_organizer_invitations')->where('token_hash', hash('sha256', $token))->whereNull('accepted_at')->where('expires_at', '>', now());
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first() ?? throw ValidationException::withMessages(['token' => 'This invitation has expired or is no longer valid. Ask an organizer for a new invitation.']);
    }
}
