<?php

// Never inherit the running application's database when executing tests.
$postgres = getenv('AREWAVANTA_TEST_DATABASE') === 'pgsql';
$testEnvironment = [
    'APP_ENV' => 'testing',
    'DB_CONNECTION' => $postgres ? 'pgsql' : 'sqlite',
    'DB_DATABASE' => $postgres ? 'aga_test' : ':memory:',
    'DB_URL' => '',
    'CACHE_STORE' => 'array',
    'SESSION_DRIVER' => 'array',
    'QUEUE_CONNECTION' => 'sync',
];

foreach ($testEnvironment as $name => $value) {
    putenv($name.'='.$value);
    $_ENV[$name] = $value;
    $_SERVER[$name] = $value;
}

require dirname(__DIR__).'/vendor/autoload.php';
