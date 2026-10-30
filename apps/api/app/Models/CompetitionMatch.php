<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable(['event_day_id', 'match_index', 'map_code', 'map_label', 'scoring_rule_version_id', 'rules_snapshot', 'result_status'])]
class CompetitionMatch extends Model
{
    use HasUlids, SoftDeletes;

    protected $table = 'matches';

    protected function casts(): array
    {
        return [
            'match_index' => 'integer',
            'rules_snapshot' => 'array',
        ];
    }

    public function day(): BelongsTo
    {
        return $this->belongsTo(EventDay::class, 'event_day_id');
    }

    public function scoringRuleVersion(): BelongsTo
    {
        return $this->belongsTo(ScoringRuleVersion::class);
    }

    public function currentResult(): BelongsTo
    {
        return $this->belongsTo(MatchResult::class, 'current_published_revision_id');
    }

    public function squadEntries(): HasMany
    {
        return $this->hasMany(MatchSquad::class, 'match_id');
    }

    public function resultRecords(): HasMany
    {
        return $this->hasMany(MatchResult::class, 'match_id')->orderBy('revision_number');
    }
}
