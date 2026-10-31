<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table): void {
            $table->unsignedSmallInteger('squad_capacity')->default(20)->after('squad_size');
        });

        DB::table('event_squads')->where('status', 'active')->select('event_id')->selectRaw('COUNT(*) as active_count')
            ->groupBy('event_id')->get()->each(function ($entry): void {
                if ((int) $entry->active_count > 20) {
                    DB::table('events')->where('id', $entry->event_id)->update(['squad_capacity' => $entry->active_count]);
                }
            });

        Schema::create('event_squad_submissions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('squad_id')->constrained()->restrictOnDelete();
            $table->string('status', 24)->default('pending');
            $table->foreignId('submitted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('submitted_at')->nullable();
            $table->timestampTz('decided_at')->nullable();
            $table->timestamps();
            $table->unique(['event_id', 'squad_id']);
            $table->index(['event_id', 'status']);
            $table->index(['squad_id', 'status']);
        });

        DB::table('event_squads')->where('status', 'active')->orderBy('id')->chunkById(500, function ($entries): void {
            foreach ($entries as $entry) {
                DB::table('event_squad_submissions')->insert([
                    'id' => (string) Str::ulid(),
                    'event_id' => $entry->event_id,
                    'squad_id' => $entry->squad_id,
                    'status' => 'selected',
                    'submitted_by' => $entry->added_by,
                    'decided_by' => $entry->added_by,
                    'submitted_at' => $entry->created_at,
                    'decided_at' => $entry->created_at,
                    'created_at' => $entry->created_at,
                    'updated_at' => $entry->updated_at,
                ]);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('event_squad_submissions');
        Schema::table('events', function (Blueprint $table): void {
            $table->dropColumn('squad_capacity');
        });
    }
};
