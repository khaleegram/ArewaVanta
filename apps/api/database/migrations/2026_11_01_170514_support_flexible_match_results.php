<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('match_squad_results', function (Blueprint $table): void {
            $table->unsignedInteger('team_kills_override')->nullable();
            $table->boolean('kills_confirmed')->default(true);
        });
        // Keep every existing team score, including results without named players.
        DB::table('match_squad_results')->where('participation_status', 'present')
            ->where(function ($query): void {
                $query->whereNotExists(fn ($players) => $players->selectRaw('1')->from('revision_player_results')
                    ->whereColumn('match_squad_result_id', 'match_squad_results.id'))
                    ->orWhereRaw('team_kills <> (SELECT COALESCE(SUM(kills), 0) FROM revision_player_results WHERE match_squad_result_id = match_squad_results.id)');
            })->update(['team_kills_override' => DB::raw('team_kills')]);
        Schema::table('revision_player_results', function (Blueprint $table): void {
            $table->unsignedInteger('kills')->nullable()->change();
        });
        DB::table('events')->update(['track_player_kills' => true]);
    }

    public function down(): void
    {
        DB::table('revision_player_results')->whereNull('kills')->update(['kills' => 0]);
        Schema::table('revision_player_results', function (Blueprint $table): void {
            $table->unsignedInteger('kills')->nullable(false)->change();
        });
        Schema::table('match_squad_results', function (Blueprint $table): void {
            $table->dropColumn(['team_kills_override', 'kills_confirmed']);
        });
    }
};
