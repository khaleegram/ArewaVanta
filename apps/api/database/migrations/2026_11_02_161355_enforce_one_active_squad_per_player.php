<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('LOCK TABLE squad_memberships IN SHARE ROW EXCLUSIVE MODE');
        }
        $closedAt = now();
        $seen = [];
        // Keep the latest assignment. End older ones without deleting roster history or results.
        $memberships = DB::table('squad_memberships')->whereNull('left_at')
            ->orderBy('player_id')->orderByDesc('joined_at')->orderByDesc('id')->get(['id', 'player_id']);
        foreach ($memberships as $membership) {
            if (isset($seen[$membership->player_id])) {
                DB::table('squad_memberships')->where('id', $membership->id)
                    ->update(['left_at' => $closedAt, 'updated_at' => $closedAt]);
            } else {
                $seen[$membership->player_id] = true;
            }
        }
        DB::statement('CREATE UNIQUE INDEX squad_memberships_one_active_player ON squad_memberships (player_id) WHERE left_at IS NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS squad_memberships_one_active_player');
    }
};
