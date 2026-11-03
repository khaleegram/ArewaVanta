<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ResultPermissions;
use App\Domain\Competition\ScreenshotImport\DeepSeekScreenshotReader;
use App\Domain\Competition\ScreenshotImport\ScreenshotImportFailed;
use App\Domain\Competition\ScreenshotImport\ScreenshotImportUnavailable;
use App\Domain\Competition\ScreenshotImport\ScreenshotResultMapper;
use App\Http\Controllers\Controller;
use App\Models\CompetitionMatch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

final class MatchScreenshotImportController extends Controller
{
    public function __invoke(
        Request $request,
        CompetitionMatch $match,
        ResultPermissions $permissions,
        DeepSeekScreenshotReader $reader,
        ScreenshotResultMapper $mapper,
    ): JsonResponse {
        $match->load('day.event');
        abort_unless($permissions->canManage($request->user(), $match->day->event), 403);

        $data = $request->validate([
            'images' => ['required', 'array', 'min:1', 'max:6'],
            'images.*' => ['required', 'file', 'image', 'mimes:jpeg,png,webp', 'max:5120'],
        ]);
        @set_time_limit((int) config('services.deepseek.timeout', 90) + 15);

        try {
            $extraction = $reader->extract($data['images']);
        } catch (ScreenshotImportUnavailable $exception) {
            return response()->json(['message' => $exception->getMessage()], 503);
        } catch (ScreenshotImportFailed $exception) {
            return response()->json(['message' => $exception->getMessage()], 502);
        } catch (Throwable $exception) {
            Log::error('Screenshot import failed unexpectedly.', ['message' => $exception->getMessage()]);

            return response()->json(['message' => 'The screenshot reader failed. Try again or enter the scores manually.'], 502);
        }

        $sheetResponse = app(MatchResultSheetController::class)(
            $request,
            $match,
            $permissions,
        );
        $sheet = $sheetResponse->getData(true)['data'];
        $mapped = $mapper->map($extraction, $sheet);

        return response()->json(['data' => $mapped], headers: ['Cache-Control' => 'private, no-store']);
    }
}
