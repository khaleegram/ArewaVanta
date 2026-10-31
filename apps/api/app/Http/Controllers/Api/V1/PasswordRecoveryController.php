<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;
use Throwable;

final class PasswordRecoveryController extends Controller
{
    private const RESET_LINK_MESSAGE = 'If an ArewaVanta account exists for that address, a reset link will be sent.';

    public function sendLink(Request $request): JsonResponse
    {
        $request->merge(['email' => Str::lower(trim((string) $request->input('email')))]);
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
        ]);

        try {
            Password::sendResetLink($data);
        } catch (Throwable $exception) {
            report($exception);
        }

        return response()->json(['message' => self::RESET_LINK_MESSAGE], 202);
    }

    public function reset(Request $request): JsonResponse
    {
        $request->merge(['email' => Str::lower(trim((string) $request->input('email')))]);
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'token' => ['required', 'string', 'size:64'],
            'password' => ['required', 'string', 'confirmed', PasswordRule::min(12)],
        ]);

        $status = Password::reset($data, function (User $user, string $password): void {
            $user->forceFill([
                'password' => $password,
                'remember_token' => Str::random(60),
            ])->save();
            $user->tokens()->delete();

            event(new PasswordReset($user));
        });

        if ($status !== Password::PASSWORD_RESET) {
            return response()->json(['message' => 'This reset link is invalid or has expired.'], 422);
        }

        return response()->json(['message' => 'Your password has been reset. Sign in with your new password.']);
    }
}
