<?php

return [
    'public_read_per_minute' => (int) env('PUBLIC_READ_RATE_LIMIT', 120),
    'public_search_per_minute' => (int) env('PUBLIC_SEARCH_RATE_LIMIT', 30),
];
