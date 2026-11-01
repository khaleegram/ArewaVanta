<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table): void {
            $table->boolean('track_player_kills')->default(true);
        });

        // Keep saved squad scores and player records; scrims now collect squad totals.
        DB::table('events')->where('competition_type', 'scrim')->update(['track_player_kills' => false]);
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table): void {
            $table->dropColumn('track_player_kills');
        });
    }
};
