<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

class CompetitionSeriesFactory extends Factory
{
    public function definition(): array
    {
        return ['timezone' => 'Africa/Lagos', 'next_week_date' => '2026-11-07', 'created_by' => User::factory()];
    }
}
