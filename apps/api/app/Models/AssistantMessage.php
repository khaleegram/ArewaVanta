<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['thread_id', 'client_id', 'role', 'status', 'content', 'details'])]
class AssistantMessage extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return ['details' => 'array'];
    }
}
