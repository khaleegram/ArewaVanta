<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['match_id', 'revision_number', 'status', 'idempotency_key', 'authored_by', 'published_at', 'rules_snapshot'])]
class MatchResult extends Model
{
    use HasUlids;

    protected $table = 'match_result_revisions';

    protected function casts(): array
    {
        return [
            'revision_number' => 'integer',
            'rules_snapshot' => 'array',
            'published_at' => 'datetime',
        ];
    }

    public function match(): BelongsTo
    {
        return $this->belongsTo(CompetitionMatch::class, 'match_id');
    }

    public function squadResults(): HasMany
    {
        return $this->hasMany(MatchSquadResult::class, 'revision_id');
    }
}
