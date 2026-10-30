<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['competition_template_id', 'label', 'sort_order'])]
class CompetitionTemplateDay extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return [
            'sort_order' => 'integer',
        ];
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(CompetitionTemplate::class, 'competition_template_id');
    }

    public function games(): HasMany
    {
        return $this->hasMany(CompetitionTemplateGame::class)->orderBy('game_number');
    }
}
