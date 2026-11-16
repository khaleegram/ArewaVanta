<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\Assistant\ConverseWithAssistant;
use App\Domain\Competition\ResultPermissions;
use App\Domain\Competition\ScreenshotImport\ScreenshotImportFailed;
use App\Domain\Competition\ScreenshotImport\ScreenshotImportUnavailable;
use App\Http\Controllers\Controller;
use App\Http\Requests\AssistantMessageRequest;
use App\Models\AssistantEvidence;
use App\Models\AssistantThread;
use App\Models\CompetitionEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class OrganizerAssistantController extends Controller
{
    public function __construct(private readonly ResultPermissions $permissions) {}

    public function index(Request $request, CompetitionEvent $event): JsonResponse
    {
        abort_unless($this->permissions->canManage($request->user(), $event), 403);
        $threads = AssistantThread::query()->where('event_id', $event->id)->where('user_id', $request->user()->id)
            ->orderByDesc('updated_at')->orderByDesc('id')->limit(50)->get(['id', 'title', 'updated_at']);

        return response()->json(['data' => $threads], headers: ['Cache-Control' => 'private, no-store']);
    }

    public function store(Request $request, CompetitionEvent $event): JsonResponse
    {
        abort_unless($this->permissions->canManage($request->user(), $event), 403);
        $thread = AssistantThread::query()->create(['event_id' => $event->id, 'user_id' => $request->user()->id, 'title' => 'Result review']);

        return $this->response($thread, 201);
    }

    public function show(Request $request, AssistantThread $thread): JsonResponse
    {
        $this->authorizeThread($request, $thread);

        return $this->response($thread);
    }

    public function message(AssistantMessageRequest $request, AssistantThread $thread, ConverseWithAssistant $chat): JsonResponse
    {
        $this->authorizeThread($request, $thread);
        @set_time_limit(2 * (int) config('services.deepseek.timeout', 90) + 30);
        try {
            $chat->handle($request->user(), $thread, $request->validated());
        } catch (ScreenshotImportUnavailable $exception) {
            return response()->json(['message' => $exception->getMessage()], 503);
        } catch (ScreenshotImportFailed $exception) {
            return response()->json(['message' => $exception->getMessage()], 502);
        }

        return $this->response($thread->refresh());
    }

    public function evidence(Request $request, AssistantThread $thread, AssistantEvidence $evidence): StreamedResponse
    {
        $this->authorizeThread($request, $thread);
        abort_unless($evidence->thread_id === $thread->id, 404);
        abort_unless(Storage::disk($evidence->disk)->exists($evidence->path), 404);

        if ($evidence->mime === 'text/csv') {
            return Storage::disk($evidence->disk)->download($evidence->path, 'evidence-'.$evidence->id.'.csv', [
                'Content-Type' => 'text/csv', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff',
            ]);
        }

        return Storage::disk($evidence->disk)->response($evidence->path, 'evidence-'.$evidence->id.'.'.match ($evidence->mime) {
            'image/png' => 'png', 'image/webp' => 'webp', default => 'jpg',
        }, ['Content-Type' => $evidence->mime, 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }

    private function authorizeThread(Request $request, AssistantThread $thread): void
    {
        abort_unless((string) $thread->user_id === (string) $request->user()->id, 404);
        abort_unless($thread->event !== null && $this->permissions->canManage($request->user(), $thread->event), 403);
    }

    public function response(AssistantThread $thread, int $status = 200): JsonResponse
    {
        $thread->load(['messages', 'evidence', 'proposals']);

        return response()->json(['data' => [
            'id' => $thread->id, 'event_id' => $thread->event_id, 'title' => $thread->title,
            'processing' => $thread->processing_token !== null && $thread->processing_started_at?->isAfter(now()->subSeconds(2 * (int) config('services.deepseek.timeout', 90) + 45)),
            'messages' => $thread->messages->map(fn ($m): array => [
                'id' => $m->id, 'client_id' => $m->client_id, 'role' => $m->role, 'status' => $m->status,
                'content' => $m->content, 'details' => $m->details, 'created_at' => $m->created_at,
            ])->all(),
            'evidence' => $thread->evidence->map(fn ($e): array => [
                'id' => $e->id, 'name' => $e->name, 'mime' => $e->mime,
                'observations' => $e->mime === 'text/csv' ? null : $e->observations,
                'csv' => $e->mime === 'text/csv' ? $e->observations : null,
            ])->all(),
            'proposals' => $thread->proposals->map(fn ($p): array => [
                'id' => $p->id, 'message_id' => $p->message_id, 'match_id' => $p->match_id, 'status' => $p->status,
                'title' => $p->title, 'reason' => $p->reason, 'preview' => $p->preview, 'decided_at' => $p->decided_at,
            ])->all(),
        ]], $status, ['Cache-Control' => 'private, no-store']);
    }
}
