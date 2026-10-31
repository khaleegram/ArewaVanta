<?php

namespace Tests\Feature;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

final class TrustedProxyConfigurationTest extends TestCase
{
    public function test_forwarded_https_scheme_is_used_from_the_configured_edge_proxy(): void
    {
        config(['trustedproxy.proxies' => '*']);
        Route::get('/_test/forwarded-scheme', fn (Request $request) => response()->json([
            'secure' => $request->isSecure(),
        ]));

        $this->call('GET', '/_test/forwarded-scheme', [], [], [], [
            'HTTP_X_FORWARDED_PROTO' => 'https',
        ])->assertOk()->assertJsonPath('secure', true);
    }
}
