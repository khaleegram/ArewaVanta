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
        Schema::create('seasons', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('name', 140);
            $table->string('slug', 160)->unique();
            $table->date('starts_on')->nullable();
            $table->date('ends_on')->nullable();
            $table->string('status', 24)->default('active')->index();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('role_assignments', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 32);
            $table->string('scope_type', 24)->default('global');
            $table->string('scope_id', 26)->default('*');
            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['user_id', 'role', 'scope_type', 'scope_id']);
            $table->index(['scope_type', 'scope_id', 'role']);
        });

        Schema::create('scoring_presets', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->timestamps();
            $table->string('name', 100);
            $table->string('slug', 120)->unique();
            $table->text('description')->nullable();
            $table->boolean('is_builtin')->default(false);
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
        });

        Schema::create('scoring_rule_versions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('scoring_preset_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('version_number');
            $table->string('mode', 24);
            $table->decimal('kill_point_value', 10, 2)->default(1);
            $table->unsignedSmallInteger('maximum_position')->default(25);
            $table->decimal('fallback_placement_points', 10, 2)->nullable();
            $table->decimal('fallback_multiplier', 10, 2)->nullable();
            $table->foreignId('authored_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['scoring_preset_id', 'version_number']);
        });

        Schema::create('scoring_tiers', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('scoring_rule_version_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('position_from');
            $table->unsignedSmallInteger('position_to');
            $table->decimal('placement_points', 10, 2)->nullable();
            $table->decimal('multiplier', 10, 2)->nullable();
            $table->unique(['scoring_rule_version_id', 'position_from']);
            $table->index(['scoring_rule_version_id', 'position_to']);
        });

        Schema::create('competition_templates', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('name', 120);
            $table->string('slug', 140)->unique();
            $table->text('description')->nullable();
            $table->string('timezone', 64)->default('Africa/Lagos');
            $table->unsignedTinyInteger('squad_size')->default(4);
            $table->unsignedSmallInteger('maximum_position')->default(25);
            $table->boolean('is_system')->default(false);
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('default_rule_version_id')->nullable()->constrained('scoring_rule_versions')->nullOnDelete();
            $table->timestamps();
            $table->unique(['name', 'owner_id']);
        });

        Schema::create('competition_template_days', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('competition_template_id')->constrained()->cascadeOnDelete();
            $table->string('label', 80);
            $table->unsignedSmallInteger('sort_order');
            $table->timestamps();
            $table->unique(['competition_template_id', 'sort_order']);
        });

        Schema::create('competition_template_games', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('competition_template_day_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('game_number');
            $table->string('map_code', 40);
            $table->string('map_label', 80);
            $table->foreignUlid('rule_version_override_id')->nullable()->constrained('scoring_rule_versions')->nullOnDelete();
            $table->timestamps();
            $table->unique(['competition_template_day_id', 'game_number']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('competition_template_games');
        Schema::dropIfExists('competition_template_days');
        Schema::dropIfExists('competition_templates');
        Schema::dropIfExists('scoring_tiers');
        Schema::dropIfExists('scoring_rule_versions');
        Schema::dropIfExists('scoring_presets');
        Schema::dropIfExists('role_assignments');
        Schema::dropIfExists('seasons');
    }
};
