<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('personal_access_tokens')
            ->whereNotNull('expires_at')
            ->update(['expires_at' => null, 'updated_at' => now()]);
    }

    public function down(): void
    {
        // Token expirations cannot be restored safely after sessions have continued.
    }
};
