<?php

namespace App\Domain\Competition;

use App\Domain\Scoring\ScoringMode;
use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\CompetitionTemplate;
use App\Models\EventDay;
use App\Models\ScoringRuleVersion;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CreateCompetitionEvent
{
    public function __construct(private readonly UpdateEventSchedule $updateSchedule, private readonly ManageWeeklyScrims $weeklyScrims) {}

    /**
     * @param  array{title: string, competition_template_id: string, season_id?: string|null, scoring_rule_version_id?: string|null, dates: list<string>, timezone?: string, maximum_position?: int, squad_size?: int, squad_capacity?: int, status?: string, visibility?: string}  $data
     */
    public function handle(User $actor, array $data): CompetitionEvent
    {
        return DB::transaction(function () use ($actor, $data): CompetitionEvent {
            $template = CompetitionTemplate::query()
                ->with(['days.games.ruleVersionOverride.preset', 'defaultRuleVersion.preset'])
                ->when(isset($data['competition_template_id']),
                    fn ($query) => $query->whereKey($data['competition_template_id']),
                    fn ($query) => $query->where('slug', 'aga-weekend-default'))
                ->firstOrFail();

            $timezone = $data['timezone'] ?? $template->timezone;
            $today = CarbonImmutable::today($timezone);
            $saturday = $today->isSaturday() ? $today : $today->next(CarbonImmutable::SATURDAY);
            $dates = $data['dates'] ?? $template->days->map(fn ($day, int $index) => $saturday->addDays($index)->toDateString())->all();

            if ($template->days->isEmpty() || $template->days->contains(static fn ($day): bool => $day->games->isEmpty())) {
                throw ValidationException::withMessages([
                    'competition_template_id' => 'The selected template needs at least one day and one game on every day.',
                ]);
            }

            if (! isset($data['days']) && count($dates) !== $template->days->count()) {
                throw ValidationException::withMessages([
                    'dates' => 'Enter one calendar date for each day in the selected template.',
                ]);
            }

            $ruleVersionId = $data['scoring_rule_version_id'] ?? $template->default_rule_version_id;
            if ($ruleVersionId === null) {
                throw ValidationException::withMessages([
                    'scoring_rule_version_id' => 'Choose a scoring preset for this event.',
                ]);
            }

            $ruleVersion = ScoringRuleVersion::query()
                ->with(['preset', 'tiers'])
                ->findOrFail($ruleVersionId);

            if ($ruleVersion->preset->owner_id !== null
                && $ruleVersion->preset->owner_id !== $actor->getKey()
                && ! $actor->hasRole(Role::Organizer, RoleScope::Global, '*')
                && ! $actor->isPlatformAdmin()) {
                throw ValidationException::withMessages([
                    'scoring_rule_version_id' => 'You do not have access to the selected scoring preset.',
                ]);
            }

            // Competition entries are submitted by clan captains after the event is created.
            $rules = $ruleVersion->toScoringRules();
            $maximumPosition = $this->maximumPosition($data, $template, 0);

            if ($maximumPosition > 100) {
                throw ValidationException::withMessages([
                    'maximum_position' => 'Events can rank up to 100 squad positions.',
                ]);
            }

            if ($rules->mode === ScoringMode::KillsOnly) {
                if ($maximumPosition > $rules->maximumPosition) {
                    throw ValidationException::withMessages([
                        'scoring_rule_version_id' => 'The selected scoring preset does not support the event’s maximum squad position.',
                    ]);
                }
            } else {
                try {
                    $rules->tierForPosition($maximumPosition);
                } catch (\InvalidArgumentException) {
                    throw ValidationException::withMessages([
                        'scoring_rule_version_id' => 'Extend this scoring preset or add an explicit fallback for all event positions.',
                    ]);
                }
            }

            $eventId = (string) Str::ulid();
            $event = new CompetitionEvent([
                'season_id' => $data['season_id'] ?? null,
                'competition_template_id' => $template->id,
                'scoring_rule_version_id' => $ruleVersion->id,
                'title' => $data['title'],
                'description' => $data['description'] ?? null,
                'competition_type' => $data['competition_type'] ?? 'scrim',
                'track_player_kills' => true,
                'slug' => Str::slug($data['title']).'-'.Str::lower(substr($eventId, -8)),
                'status' => 'published',
                'visibility' => $data['visibility'] ?? 'public',
                'timezone' => $timezone,
                'squad_size' => $data['squad_size'] ?? $template->squad_size,
                'squad_capacity' => $data['squad_capacity'] ?? 25,
                'maximum_position' => $maximumPosition,
                'created_by' => $actor->getKey(),
            ]);
            $event->id = $eventId;
            $event->save();

            foreach (isset($data['days']) ? [] : $template->days as $dayOffset => $templateDay) {
                $eventDay = EventDay::query()->create([
                    'event_id' => $event->id,
                    'event_date' => $dates[$dayOffset],
                    'label' => $templateDay->label,
                    'sort_order' => $templateDay->sort_order,
                ]);

                foreach ($templateDay->games as $templateGame) {
                    $matchRuleVersion = $templateGame->ruleVersionOverride
                        ? ScoringRuleVersion::query()->with(['preset', 'tiers'])->findOrFail($templateGame->rule_version_override_id)
                        : $ruleVersion;
                    $matchRules = $matchRuleVersion->toScoringRules();

                    if ($matchRules->mode === ScoringMode::KillsOnly) {
                        $canScoreSquadCount = $maximumPosition <= $matchRules->maximumPosition;
                    } else {
                        try {
                            $matchRules->tierForPosition($maximumPosition);
                            $canScoreSquadCount = true;
                        } catch (\InvalidArgumentException) {
                            $canScoreSquadCount = false;
                        }
                    }

                    if (! $canScoreSquadCount) {
                        throw ValidationException::withMessages([
                            'competition_template_id' => 'A game scoring override does not cover every position in this event.',
                        ]);
                    }

                    $match = CompetitionMatch::query()->create([
                        'event_day_id' => $eventDay->id,
                        'match_index' => $templateGame->game_number,
                        'map_code' => $templateGame->map_code,
                        'map_label' => $templateGame->map_label,
                        'scoring_rule_version_id' => $matchRuleVersion->id,
                        'rules_snapshot' => [
                            'version_id' => $matchRuleVersion->id,
                            'preset_id' => $matchRuleVersion->preset->id,
                            'preset_slug' => $matchRuleVersion->preset->slug,
                            'preset_name' => $matchRuleVersion->preset->name,
                            'version_number' => $matchRuleVersion->version_number,
                            'rules' => $matchRules->toArray(),
                        ],
                    ]);

                }
            }

            if (isset($data['days'])) {
                $event = $this->updateSchedule->handle($actor, $event, $data['days']);
            }
            if ($event->competition_type === 'scrim') {
                return $this->weeklyScrims->ensureRecurring($event);
            }

            return $event->load([
                'season',
                'scoringRuleVersion.preset',
                'days.matches.squadEntries.squad.clan.squads:id,clan_id',
                'squadEntries.squad.clan.squads:id,clan_id',
            ]);
        });
    }

    /**
     * @param  array{maximum_position?: int}  $data
     */
    private function maximumPosition(array $data, CompetitionTemplate $template, int $squadCount): int
    {
        $configuredMaximum = (int) ($data['maximum_position'] ?? $template->maximum_position);

        if (array_key_exists('maximum_position', $data) && $configuredMaximum < $squadCount) {
            throw ValidationException::withMessages([
                'maximum_position' => 'Maximum position cannot be lower than the number of selected squads.',
            ]);
        }

        return max($configuredMaximum, $squadCount);
    }
}
