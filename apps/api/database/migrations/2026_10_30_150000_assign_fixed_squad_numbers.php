<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('squads', function (Blueprint $table): void {
            $table->unsignedSmallInteger('squad_number')->nullable()->after('name');
        });

        DB::table('clans')->select('id')->orderBy('id')->chunkById(100, function ($clans): void {
            foreach ($clans as $clan) {
                $squads = DB::table('squads')->where('clan_id', $clan->id)->orderBy('created_at')->orderBy('id')->get(['id']);

                foreach ($squads as $squad) {
                    DB::table('squads')->where('id', $squad->id)->update(['name' => '__numbering__'.$squad->id]);
                }

                foreach ($squads as $index => $squad) {
                    DB::table('squads')->where('id', $squad->id)->update([
                        'name' => 'Squad '.($index + 1),
                        'squad_number' => $index + 1,
                    ]);
                }
            }
        });

        Schema::table('squads', function (Blueprint $table): void {
            $table->unsignedSmallInteger('squad_number')->nullable(false)->change();
            $table->unique(['clan_id', 'squad_number']);
        });
    }

    public function down(): void
    {
        Schema::table('squads', function (Blueprint $table): void {
            $table->dropUnique(['clan_id', 'squad_number']);
            $table->dropColumn('squad_number');
        });
    }
};
