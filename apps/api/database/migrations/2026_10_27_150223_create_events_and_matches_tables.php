<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('season_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUlid('competition_template_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUlid('scoring_rule_version_id')->constrained()->restrictOnDelete();
            $table->string('title', 180);
            $table->string('slug', 200)->unique();
            $table->string('status', 24)->default('draft')->index();
            $table->string('visibility', 16)->default('public');
            $table->string('timezone', 64)->default('Africa/Lagos');
            $table->unsignedTinyInteger('squad_size')->default(4);
            $table->unsignedSmallInteger('maximum_position')->default(25);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['visibility', 'status']);
            $table->index(['season_id', 'status']);
        });

        Schema::create('event_days', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained()->cascadeOnDelete();
            $table->date('event_date');
            $table->string('label', 80);
            $table->unsignedSmallInteger('sort_order');
            $table->timestamps();
            $table->unique(['event_id', 'event_date']);
            $table->unique(['event_id', 'sort_order']);
        });

        Schema::create('matches', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_day_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('match_index');
            $table->string('map_code', 40);
            $table->string('map_label', 80);
            $table->foreignUlid('scoring_rule_version_id')->nullable()->constrained()->nullOnDelete();
            $table->json('rules_snapshot');
            $table->string('result_status', 24)->default('empty')->index();
            $table->ulid('current_published_revision_id')->nullable();
            $table->timestamps();
            $table->unique(['event_day_id', 'match_index']);
            $table->index(['event_day_id', 'result_status']);
        });

        Schema::create('event_squads', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('squad_id')->constrained()->restrictOnDelete();
            $table->string('status', 24)->default('active');
            $table->unsignedSmallInteger('seed')->nullable();
            $table->foreignId('added_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['event_id', 'squad_id']);
            $table->index(['event_id', 'status']);
        });

        Schema::create('match_squads', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('match_id')->constrained('matches')->cascadeOnDelete();
            $table->foreignUlid('squad_id')->constrained()->restrictOnDelete();
            $table->string('entry_status', 24)->default('expected');
            $table->timestamps();
            $table->unique(['match_id', 'squad_id']);
            $table->index(['squad_id', 'match_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('match_squads');
        Schema::dropIfExists('event_squads');
        Schema::dropIfExists('matches');
        Schema::dropIfExists('event_days');
        Schema::dropIfExists('events');
    }
};
