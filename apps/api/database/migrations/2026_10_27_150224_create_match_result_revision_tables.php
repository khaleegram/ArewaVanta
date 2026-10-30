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
        Schema::create('match_result_revisions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('match_id')->constrained('matches')->restrictOnDelete();
            $table->unsignedSmallInteger('revision_number');
            $table->string('status', 24)->default('draft')->index();
            $table->ulid('parent_revision_id')->nullable();
            $table->string('idempotency_key', 64);
            $table->text('reason')->nullable();
            $table->foreignId('authored_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('submitted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('submitted_at')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->timestamps();
            $table->unique(['match_id', 'revision_number']);
            $table->unique(['match_id', 'idempotency_key']);
            $table->unique(['id', 'match_id']);
            $table->index(['match_id', 'status']);
        });

        Schema::table('match_result_revisions', function (Blueprint $table): void {
            $table->foreign(['parent_revision_id', 'match_id'])
                ->references(['id', 'match_id'])
                ->on('match_result_revisions')
                ->restrictOnDelete();
        });

        Schema::create('match_squad_results', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('revision_id')->constrained('match_result_revisions')->restrictOnDelete();
            $table->foreignUlid('match_id')->constrained('matches')->restrictOnDelete();
            $table->foreignUlid('squad_id')->constrained()->restrictOnDelete();
            $table->string('squad_name_snapshot', 140);
            $table->string('participation_status', 16);
            $table->unsignedSmallInteger('placement')->nullable();
            $table->unsignedInteger('team_kills')->default(0);
            $table->decimal('kill_points', 14, 4)->default(0);
            $table->decimal('placement_points', 14, 4)->nullable();
            $table->decimal('placement_multiplier', 10, 4)->nullable();
            $table->decimal('total_points', 14, 4)->default(0);
            $table->timestamps();
            $table->unique(['revision_id', 'squad_id']);
            $table->unique(['id', 'revision_id']);
            $table->foreign(['revision_id', 'match_id'])
                ->references(['id', 'match_id'])
                ->on('match_result_revisions')
                ->restrictOnDelete();
            $table->foreign(['match_id', 'squad_id'])
                ->references(['match_id', 'squad_id'])
                ->on('match_squads')
                ->restrictOnDelete();
            $table->index(['revision_id', 'participation_status']);
            $table->index(['revision_id', 'placement']);
        });

        Schema::create('revision_player_results', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('revision_id')->constrained('match_result_revisions')->restrictOnDelete();
            $table->foreignUlid('match_squad_result_id')->constrained('match_squad_results')->restrictOnDelete();
            $table->foreignUlid('player_id')->constrained()->restrictOnDelete();
            $table->string('ign_snapshot', 100);
            $table->unsignedInteger('kills');
            $table->timestamps();
            $table->unique(['revision_id', 'player_id']);
            $table->foreign(['match_squad_result_id', 'revision_id'])
                ->references(['id', 'revision_id'])
                ->on('match_squad_results')
                ->restrictOnDelete();
            $table->index(['player_id', 'revision_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('revision_player_results');
        Schema::dropIfExists('match_squad_results');
        Schema::dropIfExists('match_result_revisions');
    }
};
