<?php

namespace Tests\Feature;

use Tests\TestCase;

final class TestDatabaseSafetyTest extends TestCase
{
    public function test_tests_use_only_the_dedicated_test_database(): void
    {
        $postgres = getenv('AREWAVANTA_TEST_DATABASE') === 'pgsql';

        $this->assertSame($postgres ? 'pgsql' : 'sqlite', config('database.default'));
        $this->assertSame(
            $postgres ? 'aga_test' : ':memory:',
            config('database.connections.'.config('database.default').'.database'),
        );
    }
}
