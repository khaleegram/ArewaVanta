<?php

namespace App\Console\Commands;

use App\Domain\Competition\ClanTag;
use App\Domain\Competition\ClanTagRegistry;
use App\Models\Clan;
use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;

final class SetClanTags extends Command
{
    protected $signature = 'clans:tags {slug} {tags* : One or more tags; the first becomes the primary display tag}';

    protected $description = 'Set the primary and optional tags for a clan by slug';

    public function handle(ClanTagRegistry $registry): int
    {
        $clan = Clan::query()->where('slug', $this->argument('slug'))->first();
        if ($clan === null) {
            $this->error('No clan was found with that slug.');

            return self::FAILURE;
        }

        $tags = ClanTag::normalizeList($this->argument('tags'));
        if ($tags === []) {
            $this->error('Provide at least one tag.');

            return self::FAILURE;
        }

        try {
            $registry->assertAvailable($tags, $clan->id);
        } catch (ValidationException $exception) {
            $this->error(implode(' ', $exception->errors()['tags'] ?? ['Those tags are already used.']));

            return self::FAILURE;
        }

        $registry->assign($clan, $tags);
        $clan->save();
        $this->info($clan->name.' tags: '.implode(', ', $clan->tagList()));

        return self::SUCCESS;
    }
}
