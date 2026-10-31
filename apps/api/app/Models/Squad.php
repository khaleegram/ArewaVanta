<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['clan_id', 'name', 'squad_number', 'tag', 'slug', 'status', 'captain_user_id'])]
class Squad extends Model
{
    use HasFactory, HasUlids;

    protected function casts(): array
    {
        return ['squad_number' => 'integer'];
    }

    public function clan(): BelongsTo
    {
        return $this->belongsTo(Clan::class);
    }

    public function captain(): BelongsTo
    {
        return $this->belongsTo(User::class, 'captain_user_id');
    }

    public function memberships(): HasMany
    {
        return $this->hasMany(SquadMembership::class);
    }

    public function eventEntries(): HasMany
    {
        return $this->hasMany(EventSquad::class);
    }

    public function eventSubmissions(): HasMany
    {
        return $this->hasMany(EventSquadSubmission::class);
    }
}
