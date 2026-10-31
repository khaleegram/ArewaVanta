<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('competition_series', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('timezone')->default('Africa/Lagos');
            $table->date('next_week_date');
            $table->timestamp('paused_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
        Schema::table('events', function (Blueprint $table): void {
            $table->foreignUlid('series_id')->nullable()->constrained('competition_series')->restrictOnDelete();
            $table->date('series_week_date')->nullable();
            $table->timestamp('skipped_at')->nullable();
            $table->string('skip_source', 10)->nullable();
            $table->text('skip_reason')->nullable();
            $table->unique(['series_id', 'series_week_date']);
        });
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table): void {
            $table->dropUnique(['series_id', 'series_week_date']);
            $table->dropForeign(['series_id']);
            $table->dropColumn(['series_id', 'series_week_date', 'skipped_at', 'skip_source', 'skip_reason']);
        });
        Schema::dropIfExists('competition_series');
    }
};
