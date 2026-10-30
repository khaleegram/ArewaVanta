<?php

namespace Database\Factories;

use App\Models\Player;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Player>
 */
class PlayerFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'current_ign' => fake()->unique()->userName(),
            'normalized_uid' => null,
            'avatar_key' => null,
            'uid_public' => false,
            'status' => 'active',
        ];
    }
}
