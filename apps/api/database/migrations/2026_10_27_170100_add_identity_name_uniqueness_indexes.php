<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE UNIQUE INDEX users_email_normalized_unique ON users (LOWER(email))');
        DB::statement('CREATE UNIQUE INDEX clans_name_normalized_unique ON clans (LOWER(name))');
        DB::statement('CREATE UNIQUE INDEX squads_clan_name_normalized_unique ON squads (clan_id, LOWER(name))');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS squads_clan_name_normalized_unique');
        DB::statement('DROP INDEX IF EXISTS clans_name_normalized_unique');
        DB::statement('DROP INDEX IF EXISTS users_email_normalized_unique');
    }
};
