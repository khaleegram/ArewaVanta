<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Http\Controllers\Controller;
use App\Http\Resources\ScoringPresetResource;
use App\Models\ScoringPreset;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final class ScoringPresetController extends Controller
{
    public function __invoke(): AnonymousResourceCollection
    {
        $presets = ScoringPreset::query()
            ->where('is_builtin', true)
            ->with(['versions.tiers'])
            ->orderBy('name')
            ->get();

        return ScoringPresetResource::collection($presets);
    }
}
