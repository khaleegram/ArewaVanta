<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['event_organizer_invitations', 'clan_captain_invitations'] as $tableName) {
            Schema::table($tableName, function (Blueprint $table): void {
                $table->timestamp('expires_at')->nullable()->change();
            });

            DB::table($tableName)->whereNull('accepted_at')->update(['expires_at' => null]);
        }
    }

    public function down(): void
    {
        foreach (['event_organizer_invitations', 'clan_captain_invitations'] as $tableName) {
            DB::table($tableName)->whereNull('expires_at')->update(['expires_at' => now()->addDays(7)]);

            Schema::table($tableName, function (Blueprint $table): void {
                $table->timestamp('expires_at')->nullable(false)->change();
            });
        }
    }
};
