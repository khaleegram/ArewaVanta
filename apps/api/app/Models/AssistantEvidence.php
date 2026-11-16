<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['thread_id', 'disk', 'path', 'name', 'mime', 'sha256', 'observations'])]
class AssistantEvidence extends Model
{
    use HasUlids;

    protected $table = 'assistant_evidence';

    protected function casts(): array
    {
        return ['observations' => 'array'];
    }
}
