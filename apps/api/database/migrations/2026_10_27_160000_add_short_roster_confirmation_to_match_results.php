<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('match_squad_results', function (Blueprint $table): void {
            $table->boolean('short_roster_confirmed')->default(false)->after('total_points');
        });
    }

    public function down(): void
    {
        Schema::table('match_squad_results', function (Blueprint $table): void {
            $table->dropColumn('short_roster_confirmed');
        });
    }
};
