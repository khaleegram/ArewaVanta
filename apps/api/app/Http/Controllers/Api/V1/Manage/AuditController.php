<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class AuditController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()->isPlatformAdmin(), 403);
        $filters = $request->validate([
            'action' => ['sometimes', 'string', 'max:80'],
            'entity_type' => ['sometimes', 'string', 'max:80'],
            'entity_id' => ['sometimes', 'string', 'max:26'],
            'actor_user_id' => ['sometimes', 'integer', 'min:1'],
        ]);
        $logs = AuditLog::query()->when(isset($filters['action']), fn ($query) => $query->where('action', $filters['action']))
            ->when(isset($filters['entity_type']), fn ($query) => $query->where('entity_type', $filters['entity_type']))
            ->when(isset($filters['entity_id']), fn ($query) => $query->where('entity_id', $filters['entity_id']))
            ->when(isset($filters['actor_user_id']), fn ($query) => $query->where('actor_user_id', $filters['actor_user_id']))
            ->orderByDesc('occurred_at')->orderByDesc('id')->paginate(50);

        return response()->json([
            'data' => $logs->getCollection()->map(static fn (AuditLog $log): array => [
                'id' => $log->id,
                'actor_user_id' => $log->actor_user_id,
                'action' => $log->action,
                'entity_type' => $log->entity_type,
                'entity_id' => $log->entity_id,
                'before' => $log->before_data,
                'after' => $log->after_data,
                'reason' => $log->reason,
                'occurred_at' => $log->occurred_at,
            ])->values(),
            'meta' => ['current_page' => $logs->currentPage(), 'last_page' => $logs->lastPage(), 'total' => $logs->total()],
        ]);
    }
}
