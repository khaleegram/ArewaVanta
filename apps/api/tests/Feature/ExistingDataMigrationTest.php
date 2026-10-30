<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class ExistingDataMigrationTest extends TestCase
{
    public function test_existing_scores_snapshots_and_permissions_survive_the_upgrade(): void
    {
        $originalConnection = DB::getDefaultConnection();
        $schema = null;
        if ($originalConnection === 'pgsql') {
            $this->assertSame('aga_test', config('database.connections.pgsql.database'));
            $schema = 'legacy_'.strtolower(Str::random(12));
            DB::connection($originalConnection)->statement('CREATE SCHEMA "'.$schema.'"');
            $connection = config('database.connections.pgsql');
            $connection['search_path'] = $schema;
        } else {
            $connection = ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '', 'foreign_key_constraints' => true];
        }
        config(['database.connections.legacy_upgrade' => $connection]);
        DB::setDefaultConnection('legacy_upgrade');

        try {
            $files = glob(database_path('migrations/*.php'));
            sort($files);
            foreach ($files as $file) {
                if (str_contains($file, 'simplify_competition_storage')) {
                    break;
                }
                (require $file)->up();
            }

            $ids = [];
            foreach (['clan', 'squad', 'player', 'preset', 'version', 'event', 'day', 'match', 'entry', 'revision', 'result', 'player_result', 'role'] as $key) {
                $ids[$key] = (string) Str::ulid();
            }
            DB::table('users')->insert(['id' => 1, 'name' => 'Organizer', 'email' => 'organizer@example.com', 'password' => 'hash']);
            DB::table('role_assignments')->insert(['id' => $ids['role'], 'user_id' => 1, 'role' => 'scorekeeper', 'scope_type' => 'event', 'scope_id' => $ids['event']]);
            DB::table('clans')->insert(['id' => $ids['clan'], 'name' => 'Clan', 'slug' => 'clan', 'tag' => 'CL']);
            DB::table('squads')->insert(['id' => $ids['squad'], 'clan_id' => $ids['clan'], 'name' => 'Squad', 'slug' => 'squad']);
            DB::table('players')->insert(['id' => $ids['player'], 'current_ign' => 'Player']);
            DB::table('scoring_presets')->insert(['id' => $ids['preset'], 'name' => 'AGA Balanced', 'slug' => 'aga-balanced', 'is_builtin' => true]);
            DB::table('scoring_rule_versions')->insert(['id' => $ids['version'], 'scoring_preset_id' => $ids['preset'], 'version_number' => 1, 'mode' => 'additive']);
            DB::table('events')->insert(['id' => $ids['event'], 'scoring_rule_version_id' => $ids['version'], 'title' => 'Existing event', 'slug' => 'existing-event']);
            DB::table('event_days')->insert(['id' => $ids['day'], 'event_id' => $ids['event'], 'event_date' => '2026-10-31', 'label' => 'Day', 'sort_order' => 1]);
            $snapshot = json_encode(['preset_name' => 'AGA Balanced', 'rules' => ['mode' => 'additive']], JSON_THROW_ON_ERROR);
            DB::table('matches')->insert(['id' => $ids['match'], 'event_day_id' => $ids['day'], 'match_index' => 1, 'map_code' => 'isolated', 'map_label' => 'Isolated', 'rules_snapshot' => $snapshot]);
            DB::table('match_squads')->insert(['id' => $ids['entry'], 'match_id' => $ids['match'], 'squad_id' => $ids['squad']]);
            DB::table('match_result_revisions')->insert(['id' => $ids['revision'], 'match_id' => $ids['match'], 'revision_number' => 1, 'status' => 'published', 'idempotency_key' => 'old-key']);
            DB::table('match_squad_results')->insert(['id' => $ids['result'], 'revision_id' => $ids['revision'], 'match_id' => $ids['match'], 'squad_id' => $ids['squad'], 'squad_name_snapshot' => 'Squad', 'participation_status' => 'present', 'placement' => 2, 'team_kills' => 10, 'total_points' => '19']);
            DB::table('revision_player_results')->insert(['id' => $ids['player_result'], 'revision_id' => $ids['revision'], 'match_squad_result_id' => $ids['result'], 'player_id' => $ids['player'], 'ign_snapshot' => 'Player', 'kills' => 10]);
            DB::table('matches')->where('id', $ids['match'])->update(['current_published_revision_id' => $ids['revision']]);

            (require database_path('migrations/2026_10_27_172557_simplify_competition_storage.php'))->up();

            $this->assertSame('ArewaVanta Balanced', DB::table('scoring_presets')->where('id', $ids['preset'])->value('name'));
            $this->assertSame($ids['revision'], DB::table('matches')->where('id', $ids['match'])->value('current_published_revision_id'));
            $this->assertSame(10, DB::table('revision_player_results')->where('id', $ids['player_result'])->value('kills'));
            $this->assertSame(19, (int) DB::table('match_squad_results')->where('id', $ids['result'])->value('total_points'));
            $this->assertSame('ArewaVanta Balanced', json_decode(DB::table('match_result_revisions')->where('id', $ids['revision'])->value('rules_snapshot'), true)['preset_name']);
            $this->assertSame(1, DB::table('role_assignments')->where('user_id', 1)->where('role', 'organizer')->where('scope_id', $ids['event'])->count());
            $this->assertSame(1, DB::table('role_assignments')->where('id', $ids['role'])->count());
        } finally {
            DB::setDefaultConnection($originalConnection);
            DB::purge('legacy_upgrade');
            if ($schema !== null) {
                DB::connection($originalConnection)->statement('DROP SCHEMA "'.$schema.'" CASCADE');
            }
        }
    }
}
