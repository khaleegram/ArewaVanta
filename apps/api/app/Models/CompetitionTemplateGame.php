<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['competition_template_day_id', 'game_number', 'map_code', 'map_label', 'rule_version_override_id'])]
class CompetitionTemplateGame extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return ['game_number' => 'integer'];
    }

    public function day(): BelongsTo
    {
        return $this->belongsTo(CompetitionTemplateDay::class, 'competition_template_day_id');
    }

    public function ruleVersionOverride(): BelongsTo
    {
        return $this->belongsTo(ScoringRuleVersion::class, 'rule_version_override_id');
    }
}
