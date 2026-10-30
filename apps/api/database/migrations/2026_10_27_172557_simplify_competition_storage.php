<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table): void {
            $table->softDeletes();
        });
        Schema::table('event_days', function (Blueprint $table): void {
            $table->softDeletes();
            $table->dropUnique(['event_id', 'event_date']);
            $table->dropUnique(['event_id', 'sort_order']);
        });
        Schema::table('matches', function (Blueprint $table): void {
            $table->softDeletes();
            $table->dropUnique(['event_day_id', 'match_index']);
        });
        Schema::table('match_result_revisions', function (Blueprint $table): void {
            $table->json('rules_snapshot')->nullable();
        });
        DB::statement('CREATE UNIQUE INDEX event_days_active_date_unique ON event_days (event_id, event_date) WHERE deleted_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX event_days_active_order_unique ON event_days (event_id, sort_order) WHERE deleted_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX matches_active_order_unique ON matches (event_day_id, match_index) WHERE deleted_at IS NULL');

        DB::table('scoring_presets')->where('slug', 'aga-balanced')->update(['name' => 'ArewaVanta Balanced']);
        DB::table('competition_templates')->where('slug', 'aga-weekend-default')->update(['name' => 'ArewaVanta Weekend Default']);
        DB::table('matches')->orderBy('id')->chunkById(200, function ($matches): void {
            foreach ($matches as $match) {
                $snapshot = json_decode($match->rules_snapshot, true);
                if (($snapshot['preset_name'] ?? null) === 'AGA Balanced') {
                    $snapshot['preset_name'] = 'ArewaVanta Balanced';
                    DB::table('matches')->where('id', $match->id)->update(['rules_snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR)]);
                }
                DB::table('match_result_revisions')->where('match_id', $match->id)
                    ->whereNull('rules_snapshot')->update(['rules_snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR)]);
            }
        });

        DB::table('role_assignments')->where('role', 'scorekeeper')->orderBy('id')->chunkById(200, function ($assignments): void {
            foreach ($assignments as $assignment) {
                DB::table('role_assignments')->insertOrIgnore([
                    'id' => (string) Str::ulid(), 'user_id' => $assignment->user_id, 'role' => 'organizer',
                    'scope_type' => $assignment->scope_type, 'scope_id' => $assignment->scope_id,
                    'assigned_by' => $assignment->assigned_by, 'created_at' => $assignment->created_at, 'updated_at' => $assignment->updated_at,
                ]);
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        throw new LogicException('This migration preserves existing competition history and cannot be safely reversed automatically.');
    }
};
