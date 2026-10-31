<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['timezone', 'next_week_date', 'paused_at', 'ended_at', 'created_by'])]
final class CompetitionSeries extends Model
{
    use HasFactory, HasUlids;

    protected $table = 'competition_series';

    protected function casts(): array
    {
        return ['next_week_date' => 'immutable_date', 'paused_at' => 'immutable_datetime', 'ended_at' => 'immutable_datetime'];
    }

    public function events(): HasMany
    {
        return $this->hasMany(CompetitionEvent::class, 'series_id')->orderBy('series_week_date');
    }

    public function state(): string
    {
        return $this->ended_at !== null ? 'ended' : ($this->paused_at !== null ? 'paused' : 'active');
    }
}
