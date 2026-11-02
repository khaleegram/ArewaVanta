<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('competition_series', function (Blueprint $table): void {
            $table->jsonb('default_slot_map')->nullable();
            $table->date('default_slots_effective_from')->nullable();
        });
        Schema::table('match_squads', function (Blueprint $table): void {
            $table->unsignedSmallInteger('source_team_number')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('match_squads', function (Blueprint $table): void {
            $table->dropColumn('source_team_number');
        });
        Schema::table('competition_series', function (Blueprint $table): void {
            $table->dropColumn(['default_slot_map', 'default_slots_effective_from']);
        });
    }
};
