<?php

namespace App\Console\Commands;

use App\Domain\Competition\ClanTag;
use App\Models\Clan;
use App\Models\Player;
use Illuminate\Console\Command;

final class NormalizePlayerTags extends Command
{
    protected $signature = 'players:normalize-tags {--dry-run : Report changes without writing them} {--clan= : Limit to one clan slug}';

    protected $description = 'Remove clan tags from stored player names because the clan already stores its tags';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $clanSlug = trim((string) $this->option('clan'));
        if ($clanSlug !== '' && ! Clan::query()->where('slug', $clanSlug)->exists()) {
            $this->error('No clan was found with slug '.$clanSlug.'.');

            return self::FAILURE;
        }
        $changed = 0;
        $checked = 0;

        Player::query()
            ->with('clan')
            ->whereNotNull('clan_id')
            ->when($clanSlug !== '', static fn ($query) => $query->whereHas(
                'clan',
                static fn ($clan) => $clan->where('slug', $clanSlug),
            ))
            ->orderBy('id')
            ->chunkById(200, function ($players) use ($dryRun, &$changed, &$checked): void {
                foreach ($players as $player) {
                    $tags = $player->clan?->tagList() ?? [];
                    if ($tags === []) {
                        continue;
                    }
                    $checked++;
                    $clean = ClanTag::strip($player->current_ign, $tags);
                    if ($clean === $player->current_ign || $clean === '') {
                        continue;
                    }
                    $changed++;
                    $this->line(sprintf(
                        '%s %s · %s -> %s',
                        $dryRun ? '[dry-run]' : '[updated]',
                        $player->clan?->name ?? 'Clan',
                        $player->current_ign,
                        $clean,
                    ));
                    if (! $dryRun) {
                        $player->forceFill(['current_ign' => $clean])->save();
                    }
                }
            });

        $this->info(sprintf(
            '%s %d player name%s; %d checked%s.',
            $dryRun ? 'Would normalize' : 'Normalized',
            $changed,
            $changed === 1 ? '' : 's',
            $checked,
            $clanSlug !== '' ? ' in '.$clanSlug : '',
        ));

        return self::SUCCESS;
    }
}
