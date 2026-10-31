<?php

$proxies = trim((string) env('TRUSTED_PROXIES', ''));

return [
    'proxies' => match ($proxies) {
        '' => null,
        '*', '**' => $proxies,
        default => array_map('trim', explode(',', $proxies)),
    },
];
