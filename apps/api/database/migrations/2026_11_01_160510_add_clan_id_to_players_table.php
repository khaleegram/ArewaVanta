<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('players', function (Blueprint $table): void {
            $table->foreignUlid('clan_id')->nullable()->index()->constrained('clans')->nullOnDelete();
        });

        DB::table('players')->select('id')->chunkById(500, function ($players): void {
            $memberships = DB::table('squad_memberships')->join('squads', 'squads.id', '=', 'squad_memberships.squad_id')
                ->whereIn('player_id', $players->pluck('id'))
                ->orderByDesc('squad_memberships.joined_at')->orderByDesc('squad_memberships.id')
                ->get(['player_id', 'squads.clan_id', 'left_at'])->groupBy('player_id');
            foreach ($players as $player) {
                $history = $memberships->get($player->id, collect());
                $activeClans = $history->whereNull('left_at')->pluck('clan_id')->unique();
                // Preserve removed players in their latest clan, and leave conflicting
                // active clan memberships unclaimed for an organizer to resolve.
                $clanId = $activeClans->count() === 1 ? $activeClans->first()
                    : ($activeClans->isEmpty() ? $history->first()?->clan_id : null);
                if ($clanId !== null) {
                    DB::table('players')->where('id', $player->id)->update(['clan_id' => $clanId]);
                }
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('players', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('clan_id');
        });
    }
};
