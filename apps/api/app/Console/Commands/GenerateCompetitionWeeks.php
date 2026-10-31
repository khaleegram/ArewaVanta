<?php

namespace App\Console\Commands;

use App\Domain\Competition\ManageWeeklyScrims;
use App\Models\CompetitionEvent;
use App\Models\CompetitionSeries;
use Illuminate\Console\Command;

final class GenerateCompetitionWeeks extends Command
{
    protected $signature = 'competitions:generate-weeks';

    protected $description = 'Prepare upcoming weekly scrims with fresh squad entries and empty results';

    public function handle(ManageWeeklyScrims $manager): int
    {
        $created = 0;
        CompetitionEvent::query()->where('competition_type', 'scrim')->whereNull('series_id')->eachById(function (CompetitionEvent $event) use ($manager, &$created): void {
            $prepared = $manager->ensureRecurring($event);
            $created += $prepared->series->events->count() - 1;
        });
        CompetitionSeries::query()->whereNull('paused_at')->whereNull('ended_at')->eachById(function (CompetitionSeries $series) use ($manager, &$created): void {
            $created += $manager->generate($series);
        });
        $this->info("Prepared {$created} weekly scrim(s).");

        return self::SUCCESS;
    }
}
