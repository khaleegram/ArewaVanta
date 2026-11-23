<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\OrganizationPermissions;
use App\Http\Controllers\Controller;
use App\Models\Player;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class PlayerWarningController extends Controller
{
    /** Warning history is organizer-only; it is never part of the public player profile. */
    public function __invoke(Request $request, Player $player, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);

        return response()->json(['data' => $player->warnings()->orderByDesc('issued_at')->get()->map(fn ($w): array => [
            'id' => $w->id, 'severity' => $w->severity, 'reason' => $w->reason, 'issued_at' => $w->issued_at->toIso8601String(),
            'event_id' => $w->event_id, 'match_id' => $w->match_id,
            'revoked_at' => $w->revoked_at?->toIso8601String(), 'revoked_reason' => $w->revoked_reason,
        ])], headers: ['Cache-Control' => 'private, no-store']);
    }
}
