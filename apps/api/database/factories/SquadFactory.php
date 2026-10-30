<?php

namespace Database\Factories;

use App\Models\Clan;
use App\Models\Squad;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Squad>
 */
class SquadFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'clan_id' => Clan::factory(),
            'name' => fake()->unique()->words(2, true),
            'tag' => Str::upper(fake()->unique()->lexify('????')),
            'slug' => fake()->unique()->slug(),
            'status' => 'pending',
            'captain_user_id' => null,
        ];
    }
}
