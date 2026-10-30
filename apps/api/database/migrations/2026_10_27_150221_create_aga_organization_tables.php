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
        Schema::create('clans', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->timestamps();
            $table->string('name', 120);
            $table->string('slug', 140)->unique();
            $table->string('tag', 16)->unique();
            $table->string('crest_key')->nullable();
            $table->text('bio')->nullable();
            $table->string('status', 24)->default('pending')->index();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
        });

        Schema::create('squads', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('clan_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('tag', 16)->nullable();
            $table->string('slug', 140)->unique();
            $table->string('status', 24)->default('pending')->index();
            $table->foreignId('captain_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['clan_id', 'name']);
        });

        Schema::create('players', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('current_ign', 100);
            $table->string('normalized_uid', 64)->nullable()->unique();
            $table->string('avatar_key')->nullable();
            $table->boolean('uid_public')->default(false);
            $table->string('status', 24)->default('active')->index();
            $table->timestamps();
            $table->index('current_ign');
        });

        Schema::create('squad_memberships', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('squad_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('player_id')->constrained()->restrictOnDelete();
            $table->timestampTz('joined_at');
            $table->timestampTz('left_at')->nullable();
            $table->timestamps();
            $table->index(['squad_id', 'left_at']);
            $table->index(['player_id', 'left_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('squad_memberships');
        Schema::dropIfExists('players');
        Schema::dropIfExists('squads');
        Schema::dropIfExists('clans');
    }
};
