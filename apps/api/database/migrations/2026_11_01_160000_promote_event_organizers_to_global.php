<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('role_assignments')
            ->select('user_id', DB::raw('MIN(assigned_by) as assigned_by'))
            ->where('role', 'organizer')
            ->where('scope_type', 'event')
            ->groupBy('user_id')
            ->orderBy('user_id')
            ->chunkById(500, function ($assignments): void {
                $now = now();
                $rows = $assignments->map(static fn (object $assignment): array => [
                    'id' => (string) Str::ulid(),
                    'user_id' => $assignment->user_id,
                    'role' => 'organizer',
                    'scope_type' => 'global',
                    'scope_id' => '*',
                    'assigned_by' => $assignment->assigned_by,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all();

                DB::table('role_assignments')->insertOrIgnore($rows);
            }, 'user_id');
    }

    public function down(): void
    {
        // Promotions are intentionally retained on rollback so organizers do not lose access.
    }
};
