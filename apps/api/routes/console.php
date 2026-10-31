<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('competitions:generate-weeks')
    ->weeklyOn(1, '00:05')
    ->timezone('Africa/Lagos')
    ->withoutOverlapping();
