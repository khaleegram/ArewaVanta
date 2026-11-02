<?php

namespace App\Domain\Competition;

use App\Models\Player;
use App\Models\Squad;
use App\Models\SquadMembership;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class AssignPlayerSquad
{
    public function handle(Player $player, Squad $squad, ?string $moveFromSquadId = null, ?CarbonImmutable $joinedAt = null, bool $onlyIfUnassigned = false): ?SquadMembership
    {
        return DB::transaction(function () use ($player, $squad, $moveFromSquadId, $joinedAt, $onlyIfUnassigned): ?SquadMembership {
            $player = Player::query()->lockForUpdate()->findOrFail($player->id);
            if ($player->clan_id !== $squad->clan_id) {
                throw ValidationException::withMessages(['player_id' => 'Choose a player registered with this clan.']);
            }
            $memberships = $player->squadMemberships()->whereNull('left_at')->with('squad')->get();
            if ($onlyIfUnassigned && $memberships->isNotEmpty()) {
                return $memberships->firstWhere('squad_id', $squad->id);
            }
            if ($memberships->count() > 1) {
                throw ValidationException::withMessages(['player_id' => 'This player has conflicting squad assignments. Ask an organizer to resolve their current squad before moving them.']);
            }
            $current = $memberships->first();
            if ($current?->squad_id === $squad->id) {
                return $current;
            }
            if ($moveFromSquadId !== null && $current?->squad_id !== $moveFromSquadId) {
                abort(409, 'This player’s squad changed after you opened the roster. Reload the player list before moving them.');
            }
            if ($current !== null && $moveFromSquadId === null) {
                throw ValidationException::withMessages(['player_id' => $player->current_ign.' already belongs to '.$current->squad->name.'. Use Move to change squads.']);
            }
            if ($current !== null && $current->squad->clan_id !== $squad->clan_id) {
                throw ValidationException::withMessages(['player_id' => 'This player belongs to a squad in another clan. Ask an organizer to correct their clan first.']);
            }
            $effectiveAt = $current !== null ? CarbonImmutable::now() : ($joinedAt ?? CarbonImmutable::now());
            if ($current !== null) {
                $current->forceFill(['left_at' => $effectiveAt])->save();
            }

            return SquadMembership::query()->create([
                'squad_id' => $squad->id, 'player_id' => $player->id, 'joined_at' => $effectiveAt,
            ]);
        });
    }
}
