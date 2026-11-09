<?php

namespace App\Console\Commands;

use App\Domain\Directory\MergePlayerProfiles;
use App\Models\Player;
use Illuminate\Console\Command;

final class MergePlayer extends Command
{
    protected $signature = 'players:merge
        {source : Duplicate player ULID}
        {target : Canonical player ULID}
        {--name= : Optional canonical display name}
        {--clan= : Optional canonical clan ULID}
        {--dry-run : Show what would be merged without writing}';

    protected $description = 'Merge a duplicate player profile into the canonical profile';

    public function handle(MergePlayerProfiles $merge): int
    {
        $source = Player::query()->with('matchResults')->find($this->argument('source'));
        $target = Player::query()->with('matchResults')->find($this->argument('target'));
        if ($source === null || $target === null) {
            $this->error('Both player ULIDs must exist.');

            return self::FAILURE;
        }
        if ($source->id === $target->id) {
            $this->error('Source and target are the same player.');

            return self::FAILURE;
        }

        $this->line(sprintf(
            'Source: %s (%s) · %d games',
            $source->current_ign,
            $source->id,
            $source->matchResults->count(),
        ));
        $this->line(sprintf(
            'Target: %s (%s) · %d games',
            $target->current_ign,
            $target->id,
            $target->matchResults->count(),
        ));
        if ($this->option('dry-run')) {
            $this->info('Dry run: no changes written.');

            return self::SUCCESS;
        }

        $counts = $merge->handle(
            $source,
            $target,
            $this->option('name'),
            $this->option('clan'),
        );
        $this->info(sprintf(
            'Merged: %d results moved, %d result conflicts, %d memberships, %d aliases.',
            $counts['results'],
            $counts['conflicts'],
            $counts['memberships'],
            $counts['aliases'],
        ));

        return self::SUCCESS;
    }
}
