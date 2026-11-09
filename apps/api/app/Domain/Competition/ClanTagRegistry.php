<?php

namespace App\Domain\Competition;

use App\Models\Clan;
use Illuminate\Validation\ValidationException;

final class ClanTagRegistry
{
    /** @param list<string> $tags */
    public function assertAvailable(array $tags, ?string $ignoreClanId = null): void
    {
        foreach ($tags as $tag) {
            $conflict = Clan::query()
                ->when($ignoreClanId, static fn ($query) => $query->whereKeyNot($ignoreClanId))
                ->where(static function ($query) use ($tag): void {
                    $query->where('tag', $tag)->orWhereJsonContains('tags', $tag);
                })
                ->exists();
            if ($conflict) {
                throw ValidationException::withMessages([
                    'tags' => 'The tag '.$tag.' is already used by another clan.',
                ]);
            }
        }
    }

    /** @param list<string> $tags */
    public function assign(Clan $clan, array $tags): void
    {
        $clan->tag = $tags[0] ?? null;
        $clan->tags = $tags === [] ? null : array_values($tags);
    }
}
