<?php

namespace App\Domain\Directory;

use App\Domain\Competition\ClanTag;
use App\Domain\Competition\PlayerNameSearch;
use App\Models\Clan;
use App\Models\MatchPlayerResult;
use App\Models\Player;
use App\Models\PlayerAlias;
use App\Models\SquadMembership;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class MergePlayerProfiles
{
    /**
     * Merge a duplicate profile into the canonical player without losing history.
     *
     * @return array{results: int, memberships: int, aliases: int, conflicts: int}
     */
    public function handle(Player $source, Player $target, ?string $name = null, ?string $clanId = null): array
    {
        if ($source->id === $target->id) {
            throw ValidationException::withMessages(['target_id' => 'Choose two different player profiles.']);
        }

        return DB::transaction(function () use ($source, $target, $name, $clanId): array {
            $source = Player::query()->lockForUpdate()->findOrFail($source->id);
            $target = Player::query()->lockForUpdate()->findOrFail($target->id);
            $clan = $clanId === null ? $target->clan : Clan::query()->find($clanId);
            $results = 0;
            $conflicts = 0;

            foreach (MatchPlayerResult::query()->where('player_id', $source->id)->get() as $result) {
                $existing = MatchPlayerResult::query()
                    ->where('revision_id', $result->revision_id)
                    ->where('player_id', $target->id)
                    ->first();
                if ($existing !== null) {
                    $conflicts++;
                    if ($existing->kills === null && $result->kills !== null) {
                        $existing->update(['kills' => $result->kills]);
                    }
                    $result->delete();
                    continue;
                }
                $result->update([
                    'player_id' => $target->id,
                    'ign_snapshot' => $target->current_ign,
                ]);
                $results++;
            }

            $memberships = 0;
            $targetHasActiveMembership = SquadMembership::query()
                ->where('player_id', $target->id)
                ->whereNull('left_at')
                ->exists();
            foreach (SquadMembership::query()->where('player_id', $source->id)->get() as $membership) {
                if ($membership->left_at === null && $targetHasActiveMembership) {
                    $membership->delete();
                    continue;
                }
                $membership->update(['player_id' => $target->id]);
                if ($membership->left_at === null) {
                    $targetHasActiveMembership = true;
                }
                $memberships++;
            }

            $aliases = 0;
            $aliasesToMove = [
                $source->current_ign,
                ...PlayerAlias::query()->where('player_id', $source->id)->pluck('alias')->all(),
            ];
            foreach (array_unique($aliasesToMove) as $alias) {
                $alias = trim((string) $alias);
                $key = PlayerNameSearch::key(ClanTag::strip($alias, $clan?->tagList() ?? []));
                if ($alias === '' || $key === '') {
                    continue;
                }
                $created = PlayerAlias::query()->firstOrCreate(
                    ['player_id' => $target->id, 'alias_key' => $key],
                    ['alias' => $alias, 'source' => 'merge'],
                );
                if ($created->wasRecentlyCreated) {
                    $aliases++;
                }
            }

            $source->delete();

            $updates = [];
            if ($name !== null && trim($name) !== '') {
                $updates['current_ign'] = trim($name);
            }
            if ($clanId !== null) {
                $updates['clan_id'] = $clanId;
            }
            if ($updates !== []) {
                $target->update($updates);
            }

            return [
                'results' => $results,
                'memberships' => $memberships,
                'aliases' => $aliases,
                'conflicts' => $conflicts,
            ];
        });
    }
}
