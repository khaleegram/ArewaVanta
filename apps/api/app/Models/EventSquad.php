<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['event_id', 'squad_id', 'status', 'slot_number', 'seed', 'added_by'])]
class EventSquad extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return ['slot_number' => 'integer'];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(CompetitionEvent::class);
    }

    public function squad(): BelongsTo
    {
        return $this->belongsTo(Squad::class);
    }
}
