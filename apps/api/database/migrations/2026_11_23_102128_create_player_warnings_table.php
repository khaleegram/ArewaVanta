<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('player_warnings', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('player_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('event_id')->nullable()->constrained('events')->nullOnDelete();
            $table->foreignUlid('match_id')->nullable()->constrained('matches')->nullOnDelete();
            $table->string('severity', 20)->default('warning');
            $table->text('reason');
            $table->foreignId('issued_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('issued_at');
            $table->timestampTz('revoked_at')->nullable();
            $table->foreignId('revoked_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('revoked_reason')->nullable();
            $table->timestampsTz();
            $table->index(['player_id', 'revoked_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('player_warnings');
    }
};
