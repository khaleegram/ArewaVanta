<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('public-read', fn (Request $request): Limit => Limit::perMinute(
            (int) config('rate-limiting.public_read_per_minute'),
        )->by($request->ip() ?? 'unknown'));

        RateLimiter::for('public-search', fn (Request $request): Limit => Limit::perMinute(
            (int) config('rate-limiting.public_search_per_minute'),
        )->by($request->ip() ?? 'unknown'));
    }
}
