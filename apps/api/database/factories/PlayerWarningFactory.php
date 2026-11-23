<?php

namespace Database\Factories;

use App\Models\Player;
use App\Models\PlayerWarning;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<PlayerWarning> */
class PlayerWarningFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'player_id' => Player::factory(),
            'severity' => 'warning',
            'reason' => fake()->sentence(),
            'issued_at' => now(),
        ];
    }
}
