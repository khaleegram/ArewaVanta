<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable(['event_id', 'event_date', 'label', 'sort_order'])]
class EventDay extends Model
{
    use HasUlids, SoftDeletes;

    protected function casts(): array
    {
        return [
            'event_date' => 'date',
            'sort_order' => 'integer',
        ];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(CompetitionEvent::class, 'event_id');
    }

    public function matches(): HasMany
    {
        return $this->hasMany(CompetitionMatch::class)->orderBy('match_index');
    }
}
