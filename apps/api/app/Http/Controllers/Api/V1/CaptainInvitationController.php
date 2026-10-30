<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Notifications\AdminActivity;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Http\Controllers\Controller;
use App\Models\Clan;
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

final class CaptainInvitationController extends Controller
{
    public function send(Request $request, Clan $clan): JsonResponse
    {
        abort_unless($request->user()->isPlatformAdmin(), 403);
        if (in_array(config('mail.default'), ['log', 'array'], true)) {
            return response()->json(['message' => 'Email delivery is not configured. Configure a mail service before sending invitations.'], 503);
        }
        $data = $request->validate(['email' => ['required', 'email', 'max:255']]);
        $email = Str::lower(trim($data['email']));
        $token = bin2hex(random_bytes(32));
        $url = rtrim((string) config('app.frontend_url'), '/').'/captain-invite#'.urlencode($token);
        try {
            DB::transaction(function () use ($clan, $request, $email, $token, $url): void {
                DB::table('clan_captain_invitations')->where('clan_id', $clan->id)->where('email', $email)->whereNull('accepted_at')->delete();
                DB::table('clan_captain_invitations')->insert(['clan_id' => $clan->id, 'email' => $email, 'token_hash' => hash('sha256', $token), 'invited_by' => $request->user()->id, 'expires_at' => now()->addDays(7), 'created_at' => now(), 'updated_at' => now()]);
                Mail::raw("You have been invited to manage {$clan->name} on ArewaVanta.\n\nOpen this link to accept the invitation:\n{$url}\n\nThe link expires in 7 days.", function ($message) use ($email): void {
                    $message->to($email)->subject('Your ArewaVanta clan captain invitation');
                });
            });
        } catch (\Throwable $error) {
            report($error);

            return response()->json(['message' => 'Could not send the invitation. Check the mail configuration and try again.'], 503);
        }

        return response()->json(['message' => 'Invitation sent.'], 201);
    }

    public function inspect(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'size:64']]);
        $invitation = $this->find($data['token']);
        $clan = Clan::query()->findOrFail($invitation->clan_id);
        $existing = User::query()->whereRaw('LOWER(email) = ?', [$invitation->email])->exists();

        return response()->json(['data' => ['clan' => $clan->name, 'email' => $invitation->email, 'existing_account' => $existing]])->header('Cache-Control', 'no-store');
    }

    public function accept(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'size:64'], 'name' => ['sometimes', 'string', 'max:255'], 'password' => ['required', 'string', 'max:255'], 'password_confirmation' => ['sometimes', 'string', 'max:255']]);
        $user = DB::transaction(function () use ($data): User {
            $invitation = $this->find($data['token'], true);
            $user = User::query()->whereRaw('LOWER(email) = ?', [$invitation->email])->first();
            if ($user) {
                if (! Hash::check($data['password'], $user->password)) {
                    throw ValidationException::withMessages(['password' => 'The supplied password is incorrect.']);
                }
            } else {
                validator($data, ['name' => ['required', 'string', 'max:255'], 'password' => ['required', 'confirmed', Password::min(12)]])->validate();
                $user = User::query()->create(['name' => trim($data['name']), 'email' => $invitation->email, 'password' => $data['password'], 'email_verified_at' => now()]);
                $user->forceFill(['email_verified_at' => now()])->save();
            }
            RoleAssignment::query()->firstOrCreate(['user_id' => $user->id, 'role' => Role::ClanCaptain->value, 'scope_type' => RoleScope::Clan->value, 'scope_id' => $invitation->clan_id], ['assigned_by' => $invitation->invited_by]);
            DB::table('clan_captain_invitations')->where('id', $invitation->id)->update(['accepted_at' => now(), 'updated_at' => now()]);
            app(AdminActivity::class)->record($user, $user->name.' accepted a clan captain invitation.');

            return $user;
        });

        return response()->json(['data' => ['token' => $user->createToken('arewavanta-web', ['*'], now()->addDays(30))->plainTextToken]])->header('Cache-Control', 'no-store');
    }

    private function find(string $token, bool $lock = false): object
    {
        $query = DB::table('clan_captain_invitations')->where('token_hash', hash('sha256', $token))->whereNull('accepted_at')->where('expires_at', '>', now());
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first() ?? throw ValidationException::withMessages(['token' => 'This invitation has expired or is no longer valid. Ask an admin for a new invitation.']);
    }
}
