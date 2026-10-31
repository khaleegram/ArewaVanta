<?php

namespace Tests\Feature;

use Tests\TestCase;

final class CorsConfigurationTest extends TestCase
{
    public function test_api_cors_allows_configured_frontend_origin_without_credentials(): void
    {
        config(['cors.allowed_origins' => ['https://play.arewavanta.com', 'https://captains.arewavanta.com']]);

        $response = $this->call('OPTIONS', '/api/v1/events', [], [], [], [
            'HTTP_ORIGIN' => 'https://play.arewavanta.com',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET',
            'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,content-type',
        ]);

        $response->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'https://play.arewavanta.com');
        $this->assertFalse($response->headers->has('Access-Control-Allow-Credentials'));
    }

    public function test_api_cors_rejects_unconfigured_frontend_origin(): void
    {
        config(['cors.allowed_origins' => ['https://play.arewavanta.com', 'https://captains.arewavanta.com']]);

        $response = $this->call('OPTIONS', '/api/v1/events', [], [], [], [
            'HTTP_ORIGIN' => 'https://not-arewavanta.example',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET',
        ]);

        $response->assertNoContent();
        $this->assertNull($response->headers->get('Access-Control-Allow-Origin'));
    }
}
