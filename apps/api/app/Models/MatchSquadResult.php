<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['revision_id', 'match_id', 'squad_id', 'squad_name_snapshot', 'participation_status', 'placement', 'team_kills', 'team_kills_override', 'kills_confirmed', 'kill_points', 'placement_points', 'placement_multiplier', 'total_points'])]
class MatchSquadResult extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return [
            'placement' => 'integer',
            'team_kills' => 'integer',
            'team_kills_override' => 'integer',
            'kills_confirmed' => 'boolean',
            'kill_points' => 'decimal:4',
            'placement_points' => 'decimal:4',
            'placement_multiplier' => 'decimal:4',
            'total_points' => 'decimal:4',
        ];
    }

    public function matchResult(): BelongsTo
    {
        return $this->belongsTo(MatchResult::class, 'revision_id');
    }

    public function squad(): BelongsTo
    {
        return $this->belongsTo(Squad::class);
    }

    public function playerResults(): HasMany
    {
        return $this->hasMany(MatchPlayerResult::class);
    }
}
