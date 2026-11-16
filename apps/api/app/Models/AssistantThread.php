<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['event_id', 'user_id', 'title', 'processing_token', 'processing_started_at'])]
class AssistantThread extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return ['processing_started_at' => 'immutable_datetime'];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(CompetitionEvent::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(AssistantMessage::class, 'thread_id')->orderBy('id');
    }

    public function evidence(): HasMany
    {
        return $this->hasMany(AssistantEvidence::class, 'thread_id')->orderBy('id');
    }

    public function proposals(): HasMany
    {
        return $this->hasMany(AssistantProposal::class, 'thread_id')->orderBy('id');
    }
}
