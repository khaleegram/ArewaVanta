<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('player_aliases', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('player_id')->constrained()->cascadeOnDelete();
            $table->string('alias', 100);
            $table->string('alias_key', 100)->index();
            $table->string('source', 32)->default('merge');
            $table->timestamps();
            $table->unique(['player_id', 'alias_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('player_aliases');
    }
};
