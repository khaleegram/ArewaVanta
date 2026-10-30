<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'slug', 'description', 'timezone', 'squad_size', 'maximum_position', 'is_system', 'owner_id', 'default_rule_version_id'])]
class CompetitionTemplate extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return [
            'squad_size' => 'integer',
            'maximum_position' => 'integer',
            'is_system' => 'boolean',
        ];
    }

    public function days(): HasMany
    {
        return $this->hasMany(CompetitionTemplateDay::class)->orderBy('sort_order');
    }

    public function defaultRuleVersion(): BelongsTo
    {
        return $this->belongsTo(ScoringRuleVersion::class, 'default_rule_version_id');
    }
}
