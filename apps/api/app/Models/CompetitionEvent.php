<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable(['season_id', 'competition_template_id', 'scoring_rule_version_id', 'title', 'description', 'competition_type', 'slug', 'status', 'visibility', 'timezone', 'squad_size', 'maximum_position', 'created_by'])]
class CompetitionEvent extends Model
{
    use HasUlids, SoftDeletes;

    protected $table = 'events';

    protected function casts(): array
    {
        return [
            'squad_size' => 'integer',
            'maximum_position' => 'integer',
        ];
    }

    public function season(): BelongsTo
    {
        return $this->belongsTo(Season::class);
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(CompetitionTemplate::class, 'competition_template_id');
    }

    public function scoringRuleVersion(): BelongsTo
    {
        return $this->belongsTo(ScoringRuleVersion::class);
    }

    public function days(): HasMany
    {
        return $this->hasMany(EventDay::class, 'event_id')->orderBy('sort_order');
    }

    public function squadEntries(): HasMany
    {
        return $this->hasMany(EventSquad::class, 'event_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
