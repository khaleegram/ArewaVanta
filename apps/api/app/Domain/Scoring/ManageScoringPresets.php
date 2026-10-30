<?php

namespace App\Domain\Scoring;

use App\Models\AuditLog;
use App\Models\ScoringPreset;
use App\Models\ScoringRuleVersion;
use App\Models\ScoringTier;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class ManageScoringPresets
{
    public function create(User $actor, string $name, ?string $description, ScoringRules $rules): ScoringPreset
    {
        return DB::transaction(function () use ($actor, $name, $description, $rules): ScoringPreset {
            $id = (string) Str::ulid();
            $preset = new ScoringPreset([
                'name' => $name, 'slug' => (Str::slug($name) ?: 'scoring').'-'.Str::lower(substr($id, -8)),
                'description' => $description, 'is_builtin' => false, 'owner_id' => $actor->id,
            ]);
            $preset->id = $id;
            $preset->save();
            $this->createVersion($actor, $preset, $rules, 1);

            return $preset->load('versions.tiers');
        });
    }

    public function clone(User $actor, ScoringPreset $source, string $name, ?string $description): ScoringPreset
    {
        return DB::transaction(function () use ($actor, $source, $name, $description): ScoringPreset {
            $version = $source->versions()->reorder()->with('tiers')->orderByDesc('version_number')->firstOrFail();
            $id = (string) Str::ulid();
            $preset = new ScoringPreset([
                'name' => $name,
                'slug' => (Str::slug($name) ?: 'scoring').'-'.Str::lower(substr($id, -8)),
                'description' => $description,
                'is_builtin' => false,
                'owner_id' => $actor->id,
            ]);
            $preset->id = $id;
            $preset->save();
            $this->createVersion($actor, $preset, $version->toScoringRules(), 1);
            $this->audit($actor, 'scoring_preset_cloned', $preset, ['source_preset_id' => $source->id, 'version_number' => 1]);

            return $preset->load('versions.tiers');
        });
    }

    public function addVersion(User $actor, ScoringPreset $preset, ScoringRules $rules): ScoringPreset
    {
        return DB::transaction(function () use ($actor, $preset, $rules): ScoringPreset {
            $preset = ScoringPreset::query()->lockForUpdate()->findOrFail($preset->id);
            if ($preset->is_builtin) {
                throw ValidationException::withMessages(['preset' => 'Built-in presets are read-only. Clone one to customize it.']);
            }
            $versionNumber = ((int) $preset->versions()->max('version_number')) + 1;
            $this->createVersion($actor, $preset, $rules, $versionNumber);
            $this->audit($actor, 'scoring_preset_version_created', $preset, ['version_number' => $versionNumber]);

            return $preset->load('versions.tiers');
        });
    }

    /** @param array<string, mixed> $data */
    public function parseRules(array $data): ScoringRules
    {
        try {
            return ScoringRules::fromArray($data);
        } catch (\InvalidArgumentException $exception) {
            throw ValidationException::withMessages(['rules' => $exception->getMessage()]);
        }
    }

    private function createVersion(User $actor, ScoringPreset $preset, ScoringRules $rules, int $versionNumber): void
    {
        $version = ScoringRuleVersion::query()->create([
            'scoring_preset_id' => $preset->id,
            'version_number' => $versionNumber,
            'mode' => $rules->mode->value,
            'kill_point_value' => $rules->killPointValue,
            'maximum_position' => $rules->maximumPosition,
            'fallback_placement_points' => $rules->fallbackPlacementPoints,
            'fallback_multiplier' => $rules->fallbackMultiplier,
            'authored_by' => $actor->id,
        ]);
        foreach ($rules->tiers as $tier) {
            ScoringTier::query()->create([
                'scoring_rule_version_id' => $version->id,
                'position_from' => $tier->from,
                'position_to' => $tier->through,
                'placement_points' => $tier->placementPoints,
                'multiplier' => $tier->multiplier,
            ]);
        }
    }

    /** @param array<string, mixed> $after */
    private function audit(User $actor, string $action, ScoringPreset $preset, array $after): void
    {
        AuditLog::query()->create([
            'actor_user_id' => $actor->id,
            'action' => $action,
            'entity_type' => 'scoring_preset',
            'entity_id' => $preset->id,
            'after_data' => $after,
            'occurred_at' => now(),
        ]);
    }
}
