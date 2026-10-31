<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('event_organizer_invitations', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('event_id')->constrained('events')->cascadeOnDelete();
            $table->string('email', 255);
            $table->string('token_hash', 64)->unique();
            $table->foreignId('invited_by')->constrained('users')->cascadeOnDelete();
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();
            $table->index(['event_id', 'email']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('event_organizer_invitations');
    }
};
