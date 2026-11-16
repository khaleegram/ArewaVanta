<?php

namespace App\Domain\Competition\Assistant;

use App\Domain\Competition\PlayerNameSearch;
use App\Domain\Competition\ResultPermissions;
use App\Models\AssistantMessage;
use App\Models\AssistantProposal;
use App\Models\AssistantThread;
use App\Models\AuditLog;
use App\Models\CompetitionEvent;
use App\Models\CompetitionMatch;
use App\Models\Player;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

final class AssistantCsvImports
{
    public function __construct(
        private readonly AssistantPlayerResolver $players,
        private readonly AssistantSlotChanges $slots,
        private readonly AssistantProposals $proposals,
        private readonly AssistantContext $context,
        private readonly ResultPermissions $permissions,
    ) {}

    /** Values are read from the stored CSV. The model selects columns and policies, never rewrites score rows.
     * @return list<string>
     */
    public function prepare(User $actor, AssistantThread $thread, AssistantMessage $message, mixed $actions, array $context): array
    {
        if ($actions === [] || $actions === null) {
            return [];
        }
        $warnings = [];
        if (! is_array($actions) || ! array_is_list($actions) || count($actions) !== 1) {
            return ['Import one CSV at a time so each file has a clear destination and acceptance.'];
        }
        try {
            if (! is_array($actions[0])) {
                throw new InvalidArgumentException('The CSV import action is invalid. Ask for a fresh import proposal.');
            }
            $action = Validator::make($actions[0], [
                'event_id' => ['required', Rule::in([$thread->event_id])], 'evidence_id' => ['required', 'ulid'],
                'columns' => ['required', 'array:day,date,game,match_id,team_number,placement,team_kills,players,player,player_kills'],
                'columns.*' => ['nullable', 'string', 'max:200'],
                'columns.team_number' => ['required', 'string'],
                'create_missing_players' => ['required', 'boolean'],
                'player_mappings' => ['sometimes', 'array', 'list', 'max:300'],
                'player_mappings.*.name' => ['required', 'string', 'max:150'],
                'player_mappings.*.record' => ['sometimes', 'integer', 'min:2'],
                'player_mappings.*.player_id' => ['required', 'ulid', 'exists:players,id'],
                'exclude_players' => ['sometimes', 'array', 'list', 'max:25'],
                'exclude_players.*.player_clan_id' => ['required', 'ulid', 'exists:clans,id'],
                'exclude_players.*.slot_owner_clan_id' => ['required', 'ulid', 'exists:clans,id'],
                'slot_changes' => ['sometimes', 'array', 'list', 'max:25'],
                'slot_changes.*.slot' => ['required', 'integer', 'min:1', 'max:100'],
                'slot_changes.*.clan_id' => ['required', 'ulid', 'exists:clans,id'],
                'reason' => ['required', 'string', 'max:4000'],
            ])->validate();
            $evidence = $thread->evidence()->where('mime', 'text/csv')->find($action['evidence_id']);
            if ($evidence === null || ($evidence->observations['kind'] ?? '') !== 'csv') {
                throw new InvalidArgumentException('The selected CSV is not saved in this review. Attach it or choose its saved proof.');
            }
            $table = $evidence->observations;
            $indices = [];
            foreach ($action['columns'] as $meaning => $header) {
                if ($header === null || $header === '') {
                    continue;
                }
                $found = array_keys($table['headers'], $header, true);
                if (count($found) !== 1) {
                    throw new InvalidArgumentException('The CSV column “'.$header.'” must identify one actual column.');
                }
                $indices[$meaning] = $found[0];
            }
            if (! isset($indices['match_id']) && (! isset($indices['game']) || (! isset($indices['day']) && ! isset($indices['date'])))) {
                throw new InvalidArgumentException('Identify the day/date and game columns, or a saved match ID column, before importing.');
            }
            $event = CompetitionEvent::query()->findOrFail($thread->event_id);
            $slotPlan = $this->slots->prepare($actor, $event, $action['slot_changes'] ?? []);
            $projected = $this->slots->project($context, $slotPlan);
            $this->players->load();
            $overrides = collect($action['player_mappings'] ?? [])->keyBy(fn ($p): string => ($p['record'] ?? '*').':'.$p['name']);
            $groups = [];
            $omitted = [];
            $recordKeys = [];
            foreach ($table['rows'] as $record) {
                $values = $record['values'];
                $cell = fn (string $key): string => isset($indices[$key]) ? trim($values[$indices[$key]] ?? '') : '';
                try {
                    $match = $this->match($context['schedule'], $cell('match_id'), $cell('date'), $cell('day'), $cell('game'));
                    $number = $this->number($cell('team_number'), 'TEAM/slot', 100, '/^(?:TEAM\s*|SLOT\s*)?(\d+)$/i');
                    if ($number === null) {
                        throw new InvalidArgumentException('No slot number.');
                    }
                    $loaded = collect($projected['matches'])->firstWhere('id', $match['id']);
                    $entries = collect($loaded['entries'] ?? []);
                    $matches = $entries->where('source_team_number', $number);
                    if ($matches->isEmpty()) {
                        $matches = $entries->where('slot', $number);
                    }
                    if ($matches->count() !== 1) {
                        throw new InvalidArgumentException('TEAM'.$number.' does not identify one assigned slot in this game.');
                    }
                    $entry = $matches->first();
                    $key = $match['id'].':'.$entry['squad_id'];
                    if (isset($record['duplicate_of']) && ($recordKeys[$record['duplicate_of']] ?? null) === $key) {
                        $warnings[] = 'Record '.$record['record'].' repeats record '.$record['duplicate_of'].' in the same game/slot; counted once.';

                        continue;
                    }
                    $recordKeys[$record['record']] = $key;
                    if (! isset($groups[$key])) {
                        $groups[$key] = ['match' => $match, 'entry' => $entry, 'records' => [], 'placements' => [], 'totals' => [], 'players' => []];
                    }
                    $group = &$groups[$key];
                    $group['records'][] = $record['record'];
                    foreach (['placement' => ['placements', 100], 'team_kills' => ['totals', 999]] as $field => [$list, $max]) {
                        try {
                            $value = $this->number($cell($field), $field, $max);
                            if ($value !== null && ($field !== 'placement' || $value > 0)) {
                                $group[$list][] = $value;
                            }
                        } catch (InvalidArgumentException $exception) {
                            $warnings[] = 'Record '.$record['record'].': '.$exception->getMessage().' Other known values are retained.';
                        }
                    }
                    $appearances = [];
                    if ($cell('players') !== '' && ! $this->unknown($cell('players'))) {
                        foreach (preg_split('/;\s*/u', $cell('players')) ?: [] as $text) {
                            if (trim($text) === '') {
                                continue;
                            }
                            if (! preg_match('/^(.+?)\s*\(([^()]*)\)\s*$/u', trim($text), $parts)) {
                                $omitted[] = ['record' => $record['record'], 'name' => $text, 'reason' => 'Player name/kills format is unclear; team total retained.'];

                                continue;
                            }
                            try {
                                $appearances[] = ['name' => trim($parts[1]), 'kills' => $this->number(trim($parts[2]), 'player kills', 999)];
                            } catch (InvalidArgumentException $exception) {
                                $omitted[] = ['record' => $record['record'], 'name' => $parts[1], 'reason' => $exception->getMessage()];
                            }
                        }
                    } elseif ($cell('player') !== '') {
                        $appearances[] = ['name' => $cell('player'), 'kills' => $this->number($cell('player_kills'), 'player kills', 999)];
                    }
                    foreach ($appearances as $appearance) {
                        $profile = $this->players->resolve($appearance['name'], $action['create_missing_players']);
                        $override = $overrides->get($record['record'].':'.$appearance['name']) ?? $overrides->get('*:'.$appearance['name']);
                        if ($override !== null) {
                            $selected = Player::query()->where('status', 'active')->find($override['player_id']);
                            if ($selected === null) {
                                throw new InvalidArgumentException('The chosen player profile is no longer active.');
                            }
                            $profile = ['player_id' => $selected->id, 'ign' => $selected->current_ign, 'clan_id' => $selected->clan_id, 'source_clan_id' => $profile['source_clan_id']];
                        }
                        $excluded = collect($action['exclude_players'] ?? [])->contains(fn ($rule): bool => $rule['slot_owner_clan_id'] === $entry['clan_id']
                            && in_array($rule['player_clan_id'], [$profile['clan_id'], $profile['source_clan_id']], true));
                        if ($excluded || isset($profile['unresolved'])) {
                            $omitted[] = ['record' => $record['record'], 'name' => $appearance['name'], 'reason' => $excluded ? 'Individual stats excluded by organizer instruction; team total retained.' : $profile['unresolved']];

                            continue;
                        }
                        $identity = $profile['player_id'] ?? 'new:'.($profile['clan_id'] ?? '').':'.PlayerNameSearch::key($profile['ign']);
                        unset($profile['source_clan_id']);
                        $group['players'][$identity][] = [...$profile, 'kills' => $appearance['kills'], 'source_name' => $appearance['name'], 'record' => $record['record']];
                    }
                    unset($group);
                } catch (InvalidArgumentException $exception) {
                    $warnings[] = 'Record '.$record['record'].' needs review: '.$exception->getMessage().' Only independently readable values are included.';
                } finally {
                    unset($group);
                }
            }
            $proposedClans = [];
            foreach ($groups as $group) {
                foreach ($group['players'] as $appearances) {
                    foreach ($appearances as $player) {
                        if (($player['create_player'] ?? false) && $player['clan_id'] !== null) {
                            $proposedClans[PlayerNameSearch::key($player['ign'])][$player['clan_id']] = true;
                        }
                    }
                }
            }
            foreach ($groups as &$group) {
                $merged = [];
                foreach ($group['players'] as $identity => $appearances) {
                    foreach ($appearances as $player) {
                        if (($player['create_player'] ?? false) && $player['clan_id'] === null) {
                            $clans = array_keys($proposedClans[PlayerNameSearch::key($player['ign'])] ?? []);
                            if (count($clans) === 1) {
                                $player['clan_id'] = $clans[0];
                                $identity = 'new:'.$clans[0].':'.PlayerNameSearch::key($player['ign']);
                            } elseif (count($clans) > 1) {
                                $omitted[] = ['record' => $player['record'], 'name' => $player['source_name'], 'reason' => 'This new name occurs with multiple clan tags. Untagged appearance left unresolved; team total retained.'];

                                continue;
                            }
                        }
                        if (collect($action['exclude_players'] ?? [])->contains(fn ($rule): bool => $rule['slot_owner_clan_id'] === $group['entry']['clan_id'] && $rule['player_clan_id'] === $player['clan_id'])) {
                            $omitted[] = ['record' => $player['record'], 'name' => $player['source_name'], 'reason' => 'Individual stats excluded by organizer instruction; team total retained.'];

                            continue;
                        }
                        $merged[$identity][] = $player;
                    }
                }
                $group['players'] = $merged;
            }
            unset($group);
            $seen = [];
            foreach ($groups as $key => $group) {
                foreach ($group['players'] as $identity => $appearances) {
                    $seen[$group['match']['id']][$identity][] = $key;
                }
            }
            $corrections = [];
            foreach ($groups as $group) {
                $changes = ['status' => 'present'];
                foreach (['placements' => 'placement', 'totals' => 'team_kills'] as $list => $field) {
                    $distinct = array_unique($group[$list]);
                    if (count($distinct) === 1) {
                        $changes[$field] = (int) reset($distinct);
                    } elseif (count($distinct) > 1) {
                        $warnings[] = 'Records '.implode(', ', $group['records']).': conflicting '.$field.' values left unchanged.';
                    }
                }
                $updates = [];
                foreach ($group['players'] as $identity => $appearances) {
                    $first = $appearances[0];
                    if (count(array_unique($seen[$group['match']['id']][$identity])) > 1 || count(array_unique(array_column($appearances, 'kills'), SORT_REGULAR)) > 1) {
                        $omitted[] = ['record' => $first['record'], 'name' => $first['source_name'], 'reason' => 'Conflicting appearances/kills in this game. Individual stats left unresolved; team totals retained.'];

                        continue;
                    }
                    unset($first['source_name'], $first['record']);
                    $updates[] = $first;
                }
                $loaded = collect($projected['matches'])->firstWhere('id', $group['match']['id']);
                $before = collect($loaded['results'])->firstWhere('squad_id', $group['entry']['squad_id']);
                foreach ($before['players'] ?? [] as $prior) {
                    if (collect($action['exclude_players'] ?? [])->contains(fn ($rule): bool => $rule['slot_owner_clan_id'] === $group['entry']['clan_id'] && $rule['player_clan_id'] === ($prior['clan_id'] ?? null))) {
                        $updates[] = ['player_id' => $prior['player_id'], 'remove' => true];
                    }
                }
                if (isset($changes['team_kills']) && array_sum(array_column($updates, 'kills')) > $changes['team_kills']) {
                    $warnings[] = 'Records '.implode(', ', $group['records']).': individual kills exceed the submitted team total. The submitted total is preserved; conflicting individual kills remain unknown.';
                    $updates = array_map(fn ($p): array => isset($p['remove']) ? $p : [...$p, 'kills' => null], $updates);
                }
                if ($updates !== []) {
                    $changes['player_updates'] = $updates;
                }
                $corrections[] = ['match_id' => $group['match']['id'], 'squad_id' => $group['entry']['squad_id'], 'reason' => 'CSV '.$evidence->name.', records '.implode(', ', $group['records']).'; TEAM'.($group['entry']['source_team_number'] ?? $group['entry']['slot']).' mapped by its assigned slot.', 'evidence_ids' => [$evidence->id], 'changes' => $changes];
            }
            $built = $this->proposals->build($thread, $message, $corrections, $projected);
            $warnings = array_values(array_unique([...$warnings, ...$built['warnings']]));
            if ($built['proposals'] === []) {
                return [...$warnings, 'No supported score changes were found. No results or slot allocations changed.'];
            }
            $games = $built['proposals'];
            $new = collect($games)->flatMap(fn ($g): array => $g['payload']['new_players'])->unique(fn ($p): string => ($p['clan_id'] ?? '').':'.PlayerNameSearch::key($p['ign']))->values()->all();
            $thread->proposals()->create([
                'message_id' => $message->id, 'match_id' => $games[0]['match_id'], 'status' => 'pending',
                'title' => count($games).' games · '.implode(' / ', array_unique(array_column($context['schedule'], 'date'))),
                'reason' => $action['reason'],
                'payload' => ['kind' => 'csv_import', 'import_action' => $action, 'games' => $games, 'slot_plan' => $slotPlan, 'evidence_id' => $evidence->id, 'evidence_sha256' => $evidence->sha256],
                'preview' => ['kind' => 'csv_import', 'rows' => [], 'evidence_ids' => [$evidence->id],
                    'games' => array_map(fn ($g): array => ['match_id' => $g['match_id'], 'title' => $g['title'], 'rows' => $g['preview']['rows']], $games),
                    'slot_changes' => $slotPlan['changes'] ?? [], 'affected_weeks' => $slotPlan['weeks'] ?? [],
                    'new_players' => $new, 'omitted_players' => $omitted, 'warnings' => $warnings,
                    'team_count' => count($corrections), 'create_missing_players' => $action['create_missing_players']],
            ]);

            return [];
        } catch (ValidationException $exception) {
            return ['No CSV import prepared: '.collect($exception->errors())->flatten()->first()];
        } catch (InvalidArgumentException $exception) {
            return ['No CSV import prepared: '.$exception->getMessage()];
        }
    }

    public function decide(User $actor, AssistantThread $thread, AssistantProposal $proposal, string $decision): void
    {
        DB::transaction(function () use ($actor, $thread, $proposal, $decision): void {
            $thread = AssistantThread::query()->lockForUpdate()->findOrFail($thread->id);
            abort_unless($thread->user_id === $actor->id, 404);
            $event = CompetitionEvent::query()->findOrFail($thread->event_id);
            abort_unless($this->permissions->canManage($actor, $event), 403);
            abort_if($thread->processing_token !== null && $thread->processing_started_at?->isAfter(now()->subSeconds(2 * (int) config('services.deepseek.timeout', 90) + 45)), 409, 'Wait for this review to finish.');
            $proposal = AssistantProposal::query()->where('thread_id', $thread->id)->lockForUpdate()->findOrFail($proposal->id);
            $status = $decision === 'accept' ? 'accepted' : 'rejected';
            if ($proposal->status === $status) {
                return;
            }
            abort_unless($proposal->status === 'pending', 409, 'This proposal was replaced or already decided. Ask for a fresh review.');
            if ($decision === 'accept') {
                $payload = $proposal->payload;
                abort_unless(($payload['kind'] ?? '') === 'csv_import', 422);
                $this->slots->lock($actor, $event, $payload['slot_plan']);
                $proof = $thread->evidence()->findOrFail($payload['evidence_id']);
                abort_unless(hash_equals($payload['evidence_sha256'], $proof->sha256), 409, 'The source CSV changed; review it again.');
                foreach ($payload['games'] as $game) {
                    $match = CompetitionMatch::query()->findOrFail($game['match_id']);
                    abort_unless($match->day()->value('event_id') === $event->id, 404);
                    abort_unless(hash_equals($game['payload']['match_signature'], $this->context->forMatch($match)['signature']), 409, 'One of these games changed after review. Nothing was saved. Ask for an updated review.');
                }
                $this->slots->apply($actor, $payload['slot_plan']);
                $created = [];
                foreach ($payload['games'] as $game) {
                    $game['payload']['match_signature'] = $this->context->forMatch(CompetitionMatch::query()->findOrFail($game['match_id']))['signature'];
                    $game['payload']['parent_id'] = $proposal->id;
                    $child = $thread->proposals()->create($game);
                    $this->proposals->applyPrepared($actor, $event, $child, $created);
                    $child->update(['status' => 'accepted', 'decided_at' => now()]);
                }
                AuditLog::query()->create(['actor_user_id' => $actor->id, 'action' => 'assistant.csv_import.accepted', 'entity_type' => 'competition_event', 'entity_id' => $event->id,
                    'before_data' => ['proposal_id' => $proposal->id], 'after_data' => ['proposal_id' => $proposal->id, 'match_ids' => array_column($payload['games'], 'match_id'), 'evidence_id' => $proof->id, 'created_player_ids' => array_values($created)], 'reason' => $proposal->reason, 'occurred_at' => now()]);
            }
            $proposal->update(['status' => $status, 'decided_at' => now()]);
            $thread->touch();
        });
    }

    private function unknown(string $value): bool
    {
        return in_array(mb_strtolower(trim($value)), ['', 'unknown', 'n/a', 'na', 'null', '?', '-', '—'], true);
    }

    private function number(string $value, string $label, int $max, string $pattern = '/^(\d+)$/'): ?int
    {
        if ($this->unknown($value)) {
            return null;
        }
        if (! preg_match($pattern, $value, $matches) || (int) $matches[1] > $max) {
            throw new InvalidArgumentException('Invalid '.$label.' “'.$value.'”; no number was guessed.');
        }

        return (int) $matches[1];
    }

    private function match(array $schedule, string $id, string $date, string $day, string $game): array
    {
        $number = $this->number($game, 'game number', 100, '/^(?:GAME\s*|G\s*)?(\d+)$/i');
        $candidates = collect($schedule)->filter(function ($match) use ($id, $date, $day, $number): bool {
            if ($id !== '') {
                return $match['id'] === $id;
            }
            $weekday = CarbonImmutable::parse($match['date'])->format('l');
            $dayMatches = $day === '' || in_array(mb_strtolower($day), [mb_strtolower($match['day_label']), mb_strtolower($weekday), mb_strtolower(substr($weekday, 0, 3))], true);

            return ($date === '' || $match['date'] === $date) && $dayMatches && $number === $match['game'];
        });
        if ($candidates->count() !== 1) {
            throw new InvalidArgumentException('Day/date and game do not identify exactly one game in the selected weekend.');
        }

        return $candidates->first();
    }
}
