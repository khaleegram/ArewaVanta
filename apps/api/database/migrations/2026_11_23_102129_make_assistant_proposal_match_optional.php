<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** Administrative proposals such as slot moves and warnings are not tied to one game. */
    public function up(): void
    {
        Schema::table('assistant_proposals', function (Blueprint $table): void {
            $table->foreignUlid('match_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('assistant_proposals', function (Blueprint $table): void {
            $table->foreignUlid('match_id')->nullable(false)->change();
        });
    }
};
