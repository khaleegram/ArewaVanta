<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

final class PublicApiRateLimitingTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_player_search_allows_community_traffic_then_returns_too_many_requests(): void
    {
        for ($attempt = 0; $attempt < 30; $attempt++) {
            $this->getJson('/api/v1/players?search=arewa')->assertOk();
        }

        $this->getJson('/api/v1/players?search=arewa')->assertTooManyRequests();
    }

    public function test_public_ranking_reads_use_the_general_read_limit(): void
    {
        for ($attempt = 0; $attempt < 120; $attempt++) {
            $this->getJson('/api/v1/rankings/players')->assertOk();
        }

        $this->getJson('/api/v1/rankings/players')->assertTooManyRequests();
    }
}
