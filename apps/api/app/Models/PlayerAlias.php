<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['player_id', 'alias', 'alias_key', 'source'])]
final class PlayerAlias extends Model
{
    use HasUlids;

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }
}
