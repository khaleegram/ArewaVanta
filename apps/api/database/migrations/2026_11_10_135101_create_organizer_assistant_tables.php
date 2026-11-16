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
        Schema::create('assistant_threads', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained('events')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('title', 160)->default('Result review');
            $table->string('processing_token', 36)->nullable();
            $table->timestampTz('processing_started_at')->nullable();
            $table->timestampsTz();
            $table->index(['user_id', 'event_id', 'updated_at']);
        });
        Schema::create('assistant_messages', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('thread_id')->constrained('assistant_threads')->cascadeOnDelete();
            $table->uuid('client_id')->nullable();
            $table->string('role', 16);
            $table->string('status', 16)->default('completed');
            $table->text('content');
            $table->json('details')->nullable();
            $table->timestampsTz();
            $table->unique(['thread_id', 'client_id']);
            $table->index(['thread_id', 'id']);
        });
        Schema::create('assistant_evidence', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('thread_id')->constrained('assistant_threads')->cascadeOnDelete();
            $table->string('disk', 40);
            $table->string('path');
            $table->string('name', 200);
            $table->string('mime', 40);
            $table->char('sha256', 64);
            $table->json('observations')->nullable();
            $table->timestampsTz();
            $table->unique(['thread_id', 'sha256']);
        });
        Schema::create('assistant_proposals', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('thread_id')->constrained('assistant_threads')->cascadeOnDelete();
            $table->foreignUlid('message_id')->constrained('assistant_messages')->cascadeOnDelete();
            $table->foreignUlid('match_id')->constrained('matches')->cascadeOnDelete();
            $table->string('status', 20)->default('pending');
            $table->string('title', 200);
            $table->text('reason');
            $table->json('payload');
            $table->json('preview');
            $table->timestampTz('decided_at')->nullable();
            $table->timestampsTz();
            $table->index(['thread_id', 'status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('assistant_proposals');
        Schema::dropIfExists('assistant_evidence');
        Schema::dropIfExists('assistant_messages');
        Schema::dropIfExists('assistant_threads');
    }
};
