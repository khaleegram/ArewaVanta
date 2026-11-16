<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['thread_id', 'message_id', 'match_id', 'status', 'title', 'reason', 'payload', 'preview', 'decided_at'])]
class AssistantProposal extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return ['payload' => 'array', 'preview' => 'array', 'decided_at' => 'immutable_datetime'];
    }
}
