<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['player_id', 'event_id', 'match_id', 'severity', 'reason', 'issued_by', 'issued_at', 'revoked_at', 'revoked_by', 'revoked_reason'])]
class PlayerWarning extends Model
{
    use HasFactory, HasUlids;

    protected function casts(): array
    {
        return ['issued_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime'];
    }

    public function player(): BelongsTo
    {
        return $this->belongsTo(Player::class);
    }
}
