<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

final class AuthController extends Controller
{
    public function register(Request $request): JsonResponse
    {
        if (is_string($request->input('email'))) {
            $request->merge(['email' => Str::lower(trim($request->input('email')))]);
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['bail', 'required', 'email', 'max:255', function (string $attribute, mixed $value, \Closure $fail): void {
                if (User::query()->whereRaw('LOWER(email) = ?', [$value])->exists()) {
                    $fail('An account with this email already exists.');
                }
            }],
            'password' => ['required', 'string', 'confirmed', Password::min(12)],
            'device_name' => ['sometimes', 'string', 'max:100'],
        ]);

        $user = DB::transaction(function () use ($data): User {
            $user = User::query()->create([
                'name' => $data['name'],
                'email' => $data['email'],
                'password' => $data['password'],
            ]);

            return $user;
        });
        $token = $user->createToken($data['device_name'] ?? 'arewavanta-web', ['*'], now()->addDays(30));

        return response()->json(['data' => ['token' => $token->plainTextToken, 'user' => $this->userData($user)]], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
            'device_name' => ['sometimes', 'string', 'max:100'],
        ]);

        $email = Str::lower(trim($credentials['email']));
        $user = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();
        if ($user === null || ! Hash::check($credentials['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => 'The supplied credentials are invalid.']);
        }

        $token = $user->createToken(
            $credentials['device_name'] ?? 'arewavanta-web',
            ['*'],
            now()->addDays(30),
        );

        return response()->json([
            'data' => [
                'token' => $token->plainTextToken,
                'user' => $this->userData($user),
            ],
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $accessToken = $request->user()->currentAccessToken();
        if ($accessToken instanceof PersonalAccessToken) {
            $accessToken->delete();
        }

        return response()->json(status: 204);
    }

    public function me(Request $request): array
    {
        return ['data' => $this->userData($request->user())];
    }

    /** @return array<string, mixed> */
    private function userData(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'roles' => $user->roleAssignments()->whereIn('role', ['platform_admin', 'organizer', 'clan_captain'])->orderBy('role')->orderBy('scope_type')->orderBy('scope_id')->get([
                'role',
                'scope_type',
                'scope_id',
            ])->toArray(),
        ];
    }
}
