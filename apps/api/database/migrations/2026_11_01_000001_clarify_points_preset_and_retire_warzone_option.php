<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('scoring_presets')->where('slug', 'aga-balanced')->update([
            'name' => 'ArewaVanta Placement + Kills',
            'description' => 'Each kill earns 1 point. Placement earns additional points based on finishing position.',
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('scoring_presets')->where('slug', 'aga-balanced')->update([
            'name' => 'ArewaVanta Balanced',
            'description' => 'Rewards eliminations and survival together. Every kill earns points, while better placement adds a bonus.',
            'updated_at' => now(),
        ]);
    }
};
