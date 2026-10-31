<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table): void {
            $table->unsignedSmallInteger('squad_capacity')->default(25)->change();
        });

        Schema::table('event_squads', function (Blueprint $table): void {
            $table->unsignedSmallInteger('slot_number')->nullable()->after('status');
            $table->unique(['event_id', 'slot_number']);
        });

        DB::table('events')->select('id')->orderBy('id')->chunkById(100, function ($events): void {
            foreach ($events as $event) {
                DB::table('event_squads')->where('event_id', $event->id)->where('status', 'active')
                    ->orderBy('created_at')->orderBy('id')->get(['id'])
                    ->each(function ($entry, int $index): void {
                        DB::table('event_squads')->where('id', $entry->id)->update(['slot_number' => $index + 1]);
                    });
            }
        });

        // 20 was the former app default. Raise upcoming events using that default to the standard quartet lobby size.
        $today = Carbon::today('Africa/Lagos')->toDateString();
        DB::table('events')->where('squad_capacity', 20)->whereExists(function ($query) use ($today): void {
            $query->selectRaw('1')->from('event_days')->whereColumn('event_days.event_id', 'events.id')
                ->where('event_days.event_date', '>=', $today);
        })->update(['squad_capacity' => 25]);
    }

    public function down(): void
    {
        Schema::table('event_squads', function (Blueprint $table): void {
            $table->dropUnique(['event_id', 'slot_number']);
            $table->dropColumn('slot_number');
        });

        Schema::table('events', function (Blueprint $table): void {
            $table->unsignedSmallInteger('squad_capacity')->default(20)->change();
        });
    }
};
