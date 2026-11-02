<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['match_id', 'squad_id', 'entry_status', 'source_team_number'])]
class MatchSquad extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return ['source_team_number' => 'integer'];
    }

    public function match(): BelongsTo
    {
        return $this->belongsTo(CompetitionMatch::class, 'match_id');
    }

    public function squad(): BelongsTo
    {
        return $this->belongsTo(Squad::class);
    }
}
