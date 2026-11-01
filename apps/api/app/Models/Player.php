<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['clan_id', 'current_ign', 'normalized_uid', 'avatar_key', 'uid_public', 'status'])]
class Player extends Model
{
    use HasFactory, HasUlids;

    protected function casts(): array
    {
        return [
            'uid_public' => 'boolean',
        ];
    }

    public function squadMemberships(): HasMany
    {
        return $this->hasMany(SquadMembership::class);
    }

    public function clan(): BelongsTo
    {
        return $this->belongsTo(Clan::class);
    }

    public function matchResults(): HasMany
    {
        return $this->hasMany(MatchPlayerResult::class);
    }
}
