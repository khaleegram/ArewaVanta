<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Scoring\ManageScoringPresets;
use App\Domain\Scoring\ScoringEngine;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Http\Controllers\Controller;
use App\Http\Requests\ScoringConfigurationRequest;
use App\Http\Resources\ScoringPresetResource;
use App\Models\ScoringPreset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\ValidationException;

final class ScoringPresetController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorizeOrganizer($request);

        return ScoringPresetResource::collection(ScoringPreset::query()->where('slug', '!=', 'warzone-style-multiplier')->with('versions.tiers')->orderBy('name')->get());
    }

    public function clone(Request $request, ScoringPreset $preset, ManageScoringPresets $manager): JsonResponse
    {
        $this->authorizeOrganizer($request);
        abort_if($preset->slug === 'warzone-style-multiplier', 404);
        $data = $request->validate(['name' => ['required', 'string', 'max:100'], 'description' => ['sometimes', 'nullable', 'string', 'max:2000']]);
        $copy = $manager->clone($request->user(), $preset, $data['name'], $data['description'] ?? $preset->description);

        return (new ScoringPresetResource($copy))->response()->setStatusCode(201);
    }

    public function store(ScoringConfigurationRequest $request, ManageScoringPresets $manager): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:100'], 'description' => ['sometimes', 'nullable', 'string', 'max:2000']]);
        $preset = $manager->create($request->user(), $data['name'], $data['description'] ?? null, $manager->parseRules($request->validated('rules')));

        return (new ScoringPresetResource($preset))->response()->setStatusCode(201);
    }

    public function version(ScoringConfigurationRequest $request, ScoringPreset $preset, ManageScoringPresets $manager): JsonResponse
    {
        $rules = $manager->parseRules($request->validated('rules'));
        $preset = $manager->addVersion($request->user(), $preset, $rules);

        return (new ScoringPresetResource($preset))->response()->setStatusCode(201);
    }

    public function preview(ScoringConfigurationRequest $request, ManageScoringPresets $manager, ScoringEngine $engine): JsonResponse
    {
        $example = $request->validate([
            'team_kills' => ['required', 'integer', 'min:0', 'max:9990'],
            'placement' => ['required', 'integer', 'min:1', 'max:100'],
        ]);
        $rules = $manager->parseRules($request->validated('rules'));
        try {
            $score = $engine->score((int) $example['team_kills'], (int) $example['placement'], $rules);
        } catch (\InvalidArgumentException $exception) {
            throw ValidationException::withMessages(['placement' => $exception->getMessage()]);
        }

        return response()->json(['data' => $score->toArray()]);
    }

    private function authorizeOrganizer(Request $request): void
    {
        $user = $request->user();
        abort_unless($user->isPlatformAdmin() || $user->hasRole(Role::Organizer, RoleScope::Global, '*'), 403);
    }
}
