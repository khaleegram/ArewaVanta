<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clan_captain_invitations', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('clan_id')->constrained()->cascadeOnDelete();
            $table->string('email', 255);
            $table->string('token_hash', 64)->unique();
            $table->foreignId('invited_by')->constrained('users')->cascadeOnDelete();
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();
            $table->index(['clan_id', 'email']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clan_captain_invitations');
    }
};
