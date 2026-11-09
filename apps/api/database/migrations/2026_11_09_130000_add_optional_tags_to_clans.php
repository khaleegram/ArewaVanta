<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // SQLite cannot rebuild a table while an expression index exists.
        DB::statement('DROP INDEX IF EXISTS clans_name_normalized_unique');
        $hasTags = Schema::hasColumn('clans', 'tags');
        Schema::table('clans', function (Blueprint $table) use ($hasTags): void {
            if (! $hasTags) {
                $table->json('tags')->nullable()->after('tag');
            }
            $table->string('tag', 16)->nullable()->change();
        });

        // Keep the existing primary tag as the first entry in the new list so
        // tag matching keeps working immediately after the migration.
        foreach (DB::table('clans')->select(['id', 'tag'])->whereNotNull('tag')->get() as $clan) {
            DB::table('clans')->where('id', $clan->id)->update([
                'tags' => json_encode([$clan->tag], JSON_THROW_ON_ERROR),
            ]);
        }

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS clans_name_normalized_unique ON clans (LOWER(name))');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS clans_name_normalized_unique');
        foreach (DB::table('clans')->select(['id', 'tag', 'tags'])->whereNull('tag')->get() as $clan) {
            $tags = json_decode((string) $clan->tags, true);
            if (is_array($tags) && isset($tags[0]) && is_string($tags[0])) {
                DB::table('clans')->where('id', $clan->id)->update(['tag' => $tags[0]]);
            }
        }

        if (Schema::hasColumn('clans', 'tags')) {
            Schema::table('clans', function (Blueprint $table): void {
                $table->dropColumn('tags');
            });
        }

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS clans_name_normalized_unique ON clans (LOWER(name))');
    }
};
