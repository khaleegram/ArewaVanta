<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'slug', 'tag', 'tags', 'crest_key', 'bio', 'status', 'created_by'])]
class Clan extends Model
{
    use HasFactory, HasUlids;

    protected function casts(): array
    {
        return [
            'tags' => 'array',
        ];
    }

    /** @return list<string> */
    public function tagList(): array
    {
        $tags = is_array($this->tags) ? $this->tags : [];
        if (is_string($this->tag) && $this->tag !== '') {
            array_unshift($tags, $this->tag);
        }

        return array_values(array_unique(array_filter(array_map(
            static fn (mixed $tag): string => is_string($tag) ? trim($tag) : '',
            $tags,
        ))));
    }

    public function squads(): HasMany
    {
        return $this->hasMany(Squad::class);
    }

    public function players(): HasMany
    {
        return $this->hasMany(Player::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
