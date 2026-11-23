<?php

namespace App\Domain\Competition\Assistant;

use App\Domain\Competition\ClanTag;
use App\Domain\Competition\PlayerNameSearch;
use App\Domain\Competition\ResultPermissions;
use App\Models\Clan;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\MatchResult;
use App\Models\Player;
use App\Models\PlayerWarning;
use App\Models\ScoringPreset;
use App\Models\User;
use Carbon\CarbonImmutable;

final class AssistantContext
{
    public function __construct(private readonly ResultPermissions $permissions) {}

    /** Resolve an explicit organizer date against authorized schedule dates before calling the model. */
    public function requestedEvent(User $actor, CompetitionEvent $current, string $message): CompetitionEvent
    {
        $options = CompetitionEvent::query()->when($current->series_id !== null, fn ($q) => $q->where('series_id', $current->series_id), fn ($q) => $q->whereKey($current->id))
            ->with('days')->orderByDesc('series_week_date')->limit(24)->get()->filter(fn ($e): bool => $this->permissions->canManage($actor, $e));
        $dates = [];
        if (preg_match_all('/\b20\d{2}-\d{2}-\d{2}\b/', $message, $found, PREG_OFFSET_CAPTURE)) {
            foreach ($found[0] as [$date, $position]) {
                if (! $this->previousDateReference($message, $position)) {
                    $dates[] = $date;
                }
            }
        }
        if (preg_match_all('/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:\s*[–—-]\s*\d{1,2})?(?:,?\s+(20\d{2}))?\b/i', $message, $found, PREG_OFFSET_CAPTURE | PREG_SET_ORDER)) {
            foreach ($found as $match) {
                if ($this->previousDateReference($message, $match[0][1])) {
                    continue;
                }
                foreach ($options as $option) {
                    foreach ($option->days as $day) {
                        $date = $day->event_date;
                        if ((int) $match[2][0] === $date->day && strtolower(substr($match[1][0], 0, 3)) === strtolower($date->format('M'))
                            && (! isset($match[3][0]) || (int) $match[3][0] === $date->year)) {
                            $dates[] = $date->toDateString();
                        }
                    }
                }
            }
        }
        if ($dates === [] && preg_match('/(?:^|\b(?:its|it.s|is|for|dates?|weekend)\s+(?:is\s+|the\s+)?)(\d{1,2})\s*(?:and|&|[–—-])\s*(\d{1,2})\b/i', $message, $pair)) {
            $candidates = $options->filter(fn ($e): bool => $e->days->contains(fn ($d): bool => $d->event_date->day === (int) $pair[1]) && $e->days->contains(fn ($d): bool => $d->event_date->day === (int) $pair[2]));
        } elseif ($dates !== []) {
            $candidates = $options->filter(fn ($e): bool => $e->days->contains(fn ($d): bool => in_array($d->event_date->toDateString(), $dates, true)));
        } else {
            return $current;
        }

        return $candidates->count() === 1 ? $candidates->first() : $current;
    }

    private function previousDateReference(string $message, int $position): bool
    {
        return preg_match('/(?:earlier|previous(?:ly)?|not|instead of|replacing|rather than)\s+(?:my\s+)?$/i', substr($message, max(0, $position - 35), min(35, $position))) === 1;
    }

    /** @param list<array<string, mixed>> $csvTables
     * @return array<string, mixed>
     */
    public function forEvent(CompetitionEvent $event, ?string $focusMatchId, array $csvTables = [], ?User $actor = null): array
    {
        $event->load('days.matches');
        $schedule = $event->days->flatMap(fn ($day) => $day->matches->map(fn ($match): array => [
            'id' => $match->id, 'date' => $day->event_date->toDateString(), 'day_label' => $day->label,
            'game' => $match->match_index, 'map' => $match->map_label,
        ]))->values();
        abort_if($focusMatchId !== null && ! $schedule->contains('id', $focusMatchId), 422, 'Choose a game in this competition.');
        $csvMatchIds = $this->csvMatchIds($schedule->all(), $csvTables);
        $selected = collect($csvMatchIds)->concat($schedule->reverse()->pluck('id'))->unique()->take(12);
        if ($focusMatchId !== null) {
            $selected = $selected->prepend($focusMatchId)->unique()->take(12);
        }
        $matches = CompetitionMatch::query()->whereIn('id', $selected)
            ->with(['day.event.squadEntries', 'squadEntries.squad.clan', 'currentResult.squadResults.playerResults.player.clan'])
            ->orderBy('id')->get()->map(fn ($match): array => $this->forMatch($match))->keyBy('id');
        $players = Player::query()->with(['clan:id,name,tag,tags', 'aliases:id,player_id,alias'])
            ->orderBy('current_ign')->orderBy('id')->limit(801)->get();

        $today = CarbonImmutable::now($event->timezone ?: config('app.timezone'));
        $weekends = $actor === null ? collect() : CompetitionEvent::query()
            ->when($event->series_id !== null, fn ($query) => $query->where('series_id', $event->series_id), fn ($query) => $query->whereKey($event->id))
            ->with('days.matches')->orderByDesc('series_week_date')->limit(24)->get()
            ->filter(fn ($week): bool => $this->permissions->canManage($actor, $week))
            ->map(fn ($week): array => ['id' => $week->id, 'title' => $week->title, 'dates' => $week->days->pluck('event_date')->map(fn ($date): string => $date->toDateString())->all()])->values();

        return [
            'clock' => ['now' => $today->toIso8601String(), 'today' => $today->toDateString(), 'timezone' => $today->timezoneName],
            'managed_competitions' => $weekends->all(),
            'clans' => Clan::query()->orderBy('name')->get(['id', 'name', 'tag', 'tags'])->toArray(),
            'event' => ['id' => $event->id, 'title' => $event->title, 'description' => $event->description, 'timezone' => $event->timezone, 'squad_size' => $event->squad_size],
            'focus_match_id' => $focusMatchId,
            'lookups_remaining' => 1,
            'schedule' => $schedule->all(),
            'matches' => $matches->values()->all(),
            'players' => $players->take(800)->map($this->player(...))->all(),
            'scoring_presets' => ScoringPreset::query()->with('versions')->orderBy('name')->get()
                ->map(fn ($preset): array => ['preset' => $preset->name, 'slug' => $preset->slug, 'latest_version_id' => $preset->versions->last()?->id, 'version_number' => $preset->versions->last()?->version_number])->all(),
            'active_player_warnings' => PlayerWarning::query()->with('player:id,current_ign')->whereNull('revoked_at')->orderByDesc('issued_at')->limit(100)->get()
                ->map(fn ($w): array => ['id' => $w->id, 'player_id' => $w->player_id, 'player' => $w->player?->current_ign, 'severity' => $w->severity, 'reason' => $w->reason, 'issued_at' => $w->issued_at->toDateString()])->all(),
            'coverage' => [
                'loaded_match_ids' => $selected->values()->all(),
                'other_match_results_not_loaded' => $schedule->count() > $matches->count(),
                'player_directory_truncated' => $players->count() > 800,
                'csv_match_ids_not_loaded' => array_values(array_diff($csvMatchIds, $selected->all())),
            ],
            'published_rules' => json_decode((string) file_get_contents(resource_path('data/scrim-rules.json')), true, flags: JSON_THROW_ON_ERROR),
            'capabilities' => ['read_saved_results', 'read_slots', 'read_scoring_rules', 'read_player_directory', 'review_image_evidence', 'review_csv_evidence', 'select_managed_weekend', 'propose_result_corrections', 'propose_csv_import_with_player_creation_and_slot_changes'],
        ];
    }

    /** Loading hints only: literal ISO dates and IDs must already exist in this event's schedule.
     * @param  list<array<string, mixed>>  $schedule
     * @param  list<array<string, mixed>>  $tables
     * @return list<string>
     */
    private function csvMatchIds(array $schedule, array $tables): array
    {
        $ids = array_fill_keys(array_column($schedule, 'id'), true);
        $dates = collect($schedule)->groupBy('date');
        $found = [];
        foreach ($tables as $table) {
            foreach ($table['headers'] ?? [] as $index => $header) {
                $key = str_replace([' ', '_', '-'], '', mb_strtolower(trim($header)));
                if (! in_array($key, ['matchid', 'gameid', 'date', 'matchdate', 'gamedate', 'competitiondate'], true)) {
                    continue;
                }
                foreach ($table['rows'] ?? [] as $row) {
                    $value = trim($row['values'][$index] ?? '');
                    if (in_array($key, ['matchid', 'gameid'], true)) {
                        if (isset($ids[$value])) {
                            $found[$value] = true;
                        }
                    } elseif ($dates->has($value)) {
                        foreach ($dates->get($value) as $match) {
                            $found[$match['id']] = true;
                        }
                    }
                }
            }
        }

        return array_keys($found);
    }

    /** @return array<string, mixed> */
    public function forMatch(CompetitionMatch $match): array
    {
        $match->loadMissing(['day.event.squadEntries', 'squadEntries.squad.clan', 'currentResult.squadResults.playerResults.player.clan']);
        $legacy = $match->resultRecords()->whereIn('status', ['draft', 'revision_draft', 'submitted'])
            ->where('revision_number', '>', $match->currentResult?->revision_number ?? 0)
            ->with('squadResults.playerResults.player.clan')->reorder()->orderByDesc('revision_number')->first();
        $result = $legacy ?? $match->currentResult;
        $slots = $match->day->event->squadEntries->where('status', 'active')->keyBy('squad_id');
        $data = [
            'id' => $match->id, 'date' => $match->day->event_date->toDateString(), 'day_label' => $match->day->label,
            'game' => $match->match_index, 'map' => $match->map_label,
            'rules' => $match->rules_snapshot, 'result_id' => $result?->id, 'lock_version' => $result?->lock_version,
            'entries' => $match->squadEntries->where('entry_status', 'expected')->sortBy('squad_id')->map(fn ($entry): array => [
                'squad_id' => $entry->squad_id, 'name' => $entry->squad->name,
                'clan_id' => $entry->squad->clan_id, 'clan' => $entry->squad->clan->name,
                'clan_tag' => $entry->squad->clan->tag,
                'slot' => $slots->get($entry->squad_id)?->slot_number,
                'source_team_number' => $entry->source_team_number,
            ])->values()->all(),
            'results' => $this->rows($result),
        ];
        $data['signature'] = hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));

        return $data;
    }

    /** Bounded read tools; never execute provider-supplied SQL, URLs or write actions.
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>
     */
    public function lookUp(CompetitionEvent $event, array $context, mixed $requests, ?User $actor = null, array $csvTables = []): array
    {
        foreach (is_array($requests) ? array_slice($requests, 0, 4) : [] as $request) {
            if (! is_array($request) || ($request['type'] ?? null) !== 'competition' || $actor === null) {
                continue;
            }
            $allowed = array_column($context['managed_competitions'] ?? [], 'id');
            if (in_array($request['event_id'] ?? null, $allowed, true)) {
                $target = CompetitionEvent::query()->find($request['event_id']);
                if ($target !== null && $this->permissions->canManage($actor, $target)) {
                    $event = $target;
                    $previous = $context;
                    $context = $this->forEvent($target, null, $csvTables, $actor);
                    foreach (['requested_evidence_ids', 'proposal_decisions'] as $key) {
                        $context[$key] = $previous[$key] ?? [];
                    }
                }
            }
        }
        $results = [];
        $matches = collect($context['matches'])->keyBy('id');
        $players = collect($context['players'])->keyBy('id');
        foreach (is_array($requests) ? array_slice($requests, 0, 4) : [] as $request) {
            if (! is_array($request)) {
                continue;
            }
            if (($request['type'] ?? null) === 'match' && is_string($request['match_id'] ?? null)) {
                $match = CompetitionMatch::query()->whereHas('day', fn ($query) => $query->where('event_id', $event->id))->find($request['match_id']);
                if ($match !== null) {
                    $matches->put($match->id, $this->forMatch($match));
                    $results[] = ['type' => 'match', 'match_id' => $match->id, 'loaded' => true];
                } else {
                    $results[] = ['type' => 'match', 'loaded' => false, 'message' => 'That game is not in this competition.'];
                }
            } elseif (($request['type'] ?? null) === 'players' && is_string($request['query'] ?? null)) {
                $query = mb_substr(trim($request['query']), 0, 100);
                $key = PlayerNameSearch::key($query);
                if (strlen($key) < 2) {
                    $results[] = ['type' => 'players', 'query' => $query, 'message' => 'Use at least two name characters.'];

                    continue;
                }
                $found = Player::query()
                    ->with(['clan:id,name,tag,tags', 'aliases:id,player_id,alias'])
                    ->lazyById(300)->filter(function (Player $player) use ($query, $key): bool {
                        $name = ClanTag::strip($player->current_ign, $player->clan?->tagList() ?? []);

                        return str_contains(PlayerNameSearch::key($name), $key)
                            || PlayerNameSearch::similarity($name, $query) >= .8
                            || $player->aliases->contains(fn ($alias): bool => str_contains(PlayerNameSearch::key($alias->alias), $key));
                    })->take(21)->collect();
                foreach ($found->take(20) as $player) {
                    $players->put($player->id, $this->player($player));
                }
                $results[] = ['type' => 'players', 'query' => $query, 'matches' => $found->take(20)->map($this->player(...))->values()->all(), 'more_matches_exist' => $found->count() > 20];
            }
        }
        $context['matches'] = $matches->values()->all();
        $context['players'] = $players->values()->all();
        $context['lookup_results'] = $results;
        $context['lookups_remaining'] = 0;

        return $context;
    }

    /** @return array<string, mixed> */
    private function player(Player $player): array
    {
        return [
            'id' => $player->id, 'name' => $player->current_ign, 'clan_id' => $player->clan_id,
            'status' => $player->status,
            'clan' => $player->clan?->name, 'tags' => $player->clan?->tagList() ?? [],
            'aliases' => $player->aliases->pluck('alias')->all(),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function rows(?MatchResult $result): array
    {
        return $result?->squadResults->sortBy('squad_id')->map(fn ($row): array => [
            'squad_id' => $row->squad_id, 'status' => $row->participation_status,
            'placement' => $row->placement, 'team_kills' => $row->participation_status === 'present' && $row->kills_confirmed ? $row->team_kills : null,
            'known_player_kills' => $row->playerResults->sum('kills'),
            'team_kills_override' => $row->team_kills_override,
            'total_points' => $row->total_points,
            'players' => $row->playerResults->sortBy('player_id')->map(fn ($player): array => [
                'player_id' => $player->player_id, 'ign' => $player->ign_snapshot, 'kills' => $player->kills,
                'clan_id' => $player->player?->clan_id, 'clan_tag' => $player->player?->clan?->tag,
            ])->values()->all(),
        ])->values()->all() ?? [];
    }
}
