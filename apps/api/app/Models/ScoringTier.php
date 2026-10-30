<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['scoring_rule_version_id', 'position_from', 'position_to', 'placement_points', 'multiplier'])]
class ScoringTier extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'position_from' => 'integer',
            'position_to' => 'integer',
            'placement_points' => 'decimal:2',
            'multiplier' => 'decimal:2',
        ];
    }

    public function ruleVersion(): BelongsTo
    {
        return $this->belongsTo(ScoringRuleVersion::class, 'scoring_rule_version_id');
    }
}
