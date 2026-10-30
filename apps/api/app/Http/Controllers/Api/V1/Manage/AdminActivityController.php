<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class AdminActivityController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()->isPlatformAdmin(), 403);
        $rows = DB::table('admin_activity')->where('user_id', $request->user()->id)->orderByDesc('id')->limit(50)->get(['id', 'message', 'read_at', 'created_at']);

        return response()->json(['data' => ['items' => $rows, 'unread' => DB::table('admin_activity')->where('user_id', $request->user()->id)->whereNull('read_at')->count(), 'push_public_key' => config('services.web_push.public_key')]]);
    }

    public function read(Request $request): JsonResponse
    {
        abort_unless($request->user()->isPlatformAdmin(), 403);
        DB::table('admin_activity')->where('user_id', $request->user()->id)->whereNull('read_at')->update(['read_at' => now(), 'updated_at' => now()]);

        return response()->json(status: 204);
    }

    public function subscribe(Request $request): JsonResponse
    {
        abort_unless($request->user()->isPlatformAdmin(), 403);
        $data = $request->validate(['endpoint' => ['required', 'url', 'max:2048'], 'keys.p256dh' => ['required', 'string', 'max:255'], 'keys.auth' => ['required', 'string', 'max:255']]);
        $host = strtolower((string) parse_url($data['endpoint'], PHP_URL_HOST));
        $scheme = parse_url($data['endpoint'], PHP_URL_SCHEME);
        $allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];
        $ok = $scheme === 'https' && collect($allowed)->contains(fn ($domain) => $host === $domain || str_ends_with($host, '.'.$domain));
        if (! $ok) {
            throw ValidationException::withMessages(['endpoint' => 'This browser push service is not supported.']);
        }
        DB::table('admin_push_subscriptions')->updateOrInsert(['endpoint_hash' => hash('sha256', $data['endpoint'])], ['user_id' => $request->user()->id, 'endpoint' => $data['endpoint'], 'public_key' => $data['keys']['p256dh'], 'auth_token' => $data['keys']['auth'], 'updated_at' => now(), 'created_at' => now()]);

        return response()->json(['message' => 'Notifications enabled.']);
    }

    public function unsubscribe(Request $request): JsonResponse
    {
        abort_unless($request->user()->isPlatformAdmin(), 403);
        $data = $request->validate(['endpoint' => ['required', 'string', 'max:2048']]);
        DB::table('admin_push_subscriptions')->where('user_id', $request->user()->id)->where('endpoint_hash', hash('sha256', $data['endpoint']))->delete();

        return response()->json(status: 204);
    }
}
