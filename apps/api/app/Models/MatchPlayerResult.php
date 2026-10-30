<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['revision_id', 'match_squad_result_id', 'player_id', 'ign_snapshot', 'kills'])]
class MatchPlayerResult extends Model
{
    use HasUlids;

    protected $table = 'revision_player_results';

    protected function casts(): array
    {
        return ['kills' => 'integer'];
    }

    public function matchResult(): BelongsTo
    {
        return $this->belongsTo(MatchResult::class, 'revision_id');
    }

    public function squadResult(): BelongsTo
    {
        return $this->belongsTo(MatchSquadResult::class, 'match_squad_result_id');
    }

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }
}
