<?php

namespace App\Domain\Competition;

use App\Domain\Scoring\ScoringEngine;
use App\Domain\Scoring\ScoringRules;
use App\Models\CompetitionMatch;
use App\Models\MatchPlayerResult;
use App\Models\MatchResult;
use App\Models\MatchSquadResult;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class SaveMatchResults
{
    public function __construct(
        private readonly ScoringEngine $scoring,
        private readonly ResultPermissions $permissions,
        private readonly EligibleMatchRoster $roster,
    ) {}

    /** @param list<array<string, mixed>> $rows */
    public function handle(User $actor, CompetitionMatch $match, array $rows): MatchResult
    {
        return DB::transaction(function () use ($actor, $match, $rows): MatchResult {
            $match = CompetitionMatch::query()->with(['day.event', 'squadEntries.squad', 'currentResult.squadResults.playerResults.player'])
                ->lockForUpdate()->findOrFail($match->id);
            $event = $match->day->event;
            abort_unless($this->permissions->canManage($actor, $event), 403);
            $entries = $match->squadEntries->where('entry_status', 'expected');
            $input = collect($rows)->keyBy('squad_id');
            if ($input->keys()->diff($entries->pluck('squad_id'))->isNotEmpty()) {
                throw ValidationException::withMessages(['results' => 'Every result must belong to a squad assigned to this match.']);
            }

            $rules = ScoringRules::fromArray($match->rules_snapshot['rules']);
            $rosters = $this->roster->forMatch($match);
            $previous = $match->currentResult;
            $legacyResult = $match->resultRecords()->whereIn('status', ['draft', 'revision_draft', 'submitted'])
                ->where('revision_number', '>', $previous?->revision_number ?? 0)
                ->with('squadResults.playerResults.player')->reorder()->orderByDesc('revision_number')->first();
            $revision = $legacyResult ?? $previous;
            if ($revision === null) {
                $revision = MatchResult::query()->create([
                    'match_id' => $match->id,
                    'revision_number' => ((int) $match->resultRecords()->max('revision_number')) + 1,
                    'status' => 'published',
                    'idempotency_key' => (string) Str::ulid(),
                    'authored_by' => $actor->id,
                    'published_at' => now(),
                    'rules_snapshot' => $match->rules_snapshot,
                ]);
            } else {
                MatchPlayerResult::query()->where('revision_id', $revision->id)->delete();
                MatchSquadResult::query()->where('revision_id', $revision->id)->delete();
                $revision->forceFill(['status' => 'published', 'authored_by' => $actor->id, 'published_at' => now(), 'rules_snapshot' => $match->rules_snapshot])->save();
            }
            $seenPlayers = [];
            $placements = [];
            $presentCount = 0;

            foreach ($entries as $entry) {
                $row = $input->get($entry->squad_id);
                $status = $row === null ? 'absent' : ($row['status'] ?? 'present');
                $players = $row['players'] ?? [];
                $placement = $row['placement'] ?? null;
                $previousResult = $legacyResult?->squadResults->firstWhere('squad_id', $entry->squad_id)
                    ?? $previous?->squadResults->firstWhere('squad_id', $entry->squad_id);
                $previousPlayers = $previousResult?->playerResults->keyBy('player_id') ?? collect();
                $members = $rosters->get($entry->squad_id, collect());

                if ($status === 'absent' && ($placement !== null || $players !== [])) {
                    throw ValidationException::withMessages(['results' => 'Absent squads cannot have a placement or player kills.']);
                }
                if ($status === 'present') {
                    if ($placement === null || $placement > $event->maximum_position || isset($placements[$placement])) {
                        throw ValidationException::withMessages(['results' => 'Participating squads need unique placements within the event range.']);
                    }
                    if (count($players) < 1) {
                        throw ValidationException::withMessages(['results' => 'A participating squad needs at least one player.']);
                    }
                    $placements[$placement] = true;
                    $presentCount++;
                }

                $kills = 0;
                foreach ($players as $playerInput) {
                    $playerId = $playerInput['player_id'];
                    if (isset($seenPlayers[$playerId]) || (! $members->has($playerId) && ! $previousPlayers->has($playerId))) {
                        throw ValidationException::withMessages(['results' => 'Each player must belong to the squad roster and can play for only one squad in a match.']);
                    }
                    $seenPlayers[$playerId] = true;
                    $kills += (int) $playerInput['kills'];
                }
                try {
                    $score = $status === 'present' ? $this->scoring->score($kills, (int) $placement, $rules) : null;
                } catch (\InvalidArgumentException $exception) {
                    throw ValidationException::withMessages(['results' => $exception->getMessage()]);
                }
                $result = MatchSquadResult::query()->create([
                    'revision_id' => $revision->id, 'match_id' => $match->id, 'squad_id' => $entry->squad_id,
                    'squad_name_snapshot' => $previousResult?->squad_name_snapshot ?? $entry->squad->name,
                    'participation_status' => $status, 'placement' => $placement, 'team_kills' => $kills,
                    'kill_points' => $score?->killPoints ?? '0', 'placement_points' => $score?->placementPoints,
                    'placement_multiplier' => $score?->placementMultiplier, 'total_points' => $score?->totalPoints ?? '0',
                ]);
                foreach ($players as $playerInput) {
                    $old = $previousPlayers->get($playerInput['player_id']);
                    $player = $old?->player ?? $members->get($playerInput['player_id'])->player;
                    MatchPlayerResult::query()->create([
                        'revision_id' => $revision->id, 'match_squad_result_id' => $result->id,
                        'player_id' => $player->id, 'ign_snapshot' => $old?->ign_snapshot ?? $player->current_ign,
                        'kills' => $playerInput['kills'],
                    ]);
                }
            }
            if ($presentCount === 0) {
                throw ValidationException::withMessages(['results' => 'Enter a result for at least one squad.']);
            }
            $match->forceFill(['current_published_revision_id' => $revision->id, 'result_status' => 'published'])->save();

            return $revision->load(['squadResults.squad.clan', 'squadResults.playerResults']);
        });
    }
}
