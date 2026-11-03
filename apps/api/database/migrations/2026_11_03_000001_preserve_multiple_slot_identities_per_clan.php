<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * A clan can now own more than one competition slot, so the hidden scoring
     * identities behind those slots must share a clan. SQLite rebuilds the
     * squads table while adding squad numbers, which drops the expression from
     * the original normalized-name index; recreate it explicitly here.
     */
    public function up(): void
    {
        DB::statement('DROP INDEX IF EXISTS squads_clan_name_normalized_unique');
        DB::statement('CREATE UNIQUE INDEX squads_clan_name_normalized_unique ON squads (clan_id, LOWER(name))');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS squads_clan_name_normalized_unique');
        DB::statement('CREATE UNIQUE INDEX squads_clan_name_normalized_unique ON squads (clan_id, LOWER(name))');
    }
};
