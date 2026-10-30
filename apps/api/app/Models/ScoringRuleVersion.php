<?php

namespace App\Models;

use App\Domain\Scoring\ScoringRules;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['scoring_preset_id', 'version_number', 'mode', 'kill_point_value', 'maximum_position', 'fallback_placement_points', 'fallback_multiplier', 'authored_by'])]
class ScoringRuleVersion extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return [
            'version_number' => 'integer',
            'kill_point_value' => 'decimal:2',
            'maximum_position' => 'integer',
            'fallback_placement_points' => 'decimal:2',
            'fallback_multiplier' => 'decimal:2',
        ];
    }

    public function preset(): BelongsTo
    {
        return $this->belongsTo(ScoringPreset::class, 'scoring_preset_id');
    }

    public function tiers(): HasMany
    {
        return $this->hasMany(ScoringTier::class)->orderBy('position_from');
    }

    public function toScoringRules(): ScoringRules
    {
        return ScoringRules::fromArray([
            'mode' => $this->mode,
            'kill_point_value' => (string) $this->kill_point_value,
            'maximum_position' => (int) $this->maximum_position,
            'fallback_placement_points' => $this->fallback_placement_points === null ? null : (string) $this->fallback_placement_points,
            'fallback_multiplier' => $this->fallback_multiplier === null ? null : (string) $this->fallback_multiplier,
            'tiers' => $this->tiers->map(static fn (ScoringTier $tier): array => [
                'position_from' => (int) $tier->position_from,
                'position_to' => (int) $tier->position_to,
                'placement_points' => $tier->placement_points === null ? null : (string) $tier->placement_points,
                'multiplier' => $tier->multiplier === null ? null : (string) $tier->multiplier,
            ])->all(),
        ]);
    }
}
