<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\BuildEventStandings;
use App\Domain\Competition\OrganizationPermissions;
use App\Http\Controllers\Controller;
use App\Models\Season;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class SeasonController extends Controller
{
    public function index(Request $request, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);

        return response()->json(['data' => Season::query()->orderByDesc('starts_on')->orderBy('name')->get(['id', 'name', 'slug', 'starts_on', 'ends_on'])]);
    }

    public function store(Request $request, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:140'],
            'starts_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'ends_on' => ['sometimes', 'nullable', 'date_format:Y-m-d', Rule::when($request->filled('starts_on'), ['after_or_equal:starts_on'])],
        ]);
        $id = (string) Str::ulid();
        $season = new Season([
            'name' => $data['name'],
            'slug' => (Str::slug($data['name']) ?: 'season').'-'.Str::lower(substr($id, -8)),
            'starts_on' => $data['starts_on'] ?? null,
            'ends_on' => $data['ends_on'] ?? null,
            'status' => 'active',
            'created_by' => $request->user()->id,
        ]);
        $season->id = $id;
        $season->save();

        return response()->json(['data' => ['id' => $season->id, 'name' => $season->name, 'slug' => $season->slug]], 201);
    }

    public function standings(Request $request, Season $season, OrganizationPermissions $permissions, BuildEventStandings $standings): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);

        return response()->json(['data' => $standings->forSeason($season, false)]);
    }
}
