<?php

namespace Tests\Unit\Domain\Scoring;

use App\Domain\Scoring\PlacementTier;
use App\Domain\Scoring\ScoringEngine;
use App\Domain\Scoring\ScoringMode;
use App\Domain\Scoring\ScoringRules;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class ScoringEngineTest extends TestCase
{
    #[DataProvider('balancedPlacementPoints')]
    public function test_arewavanta_balanced_awards_the_configured_points_for_each_position(int $position, string $points): void
    {
        $score = (new ScoringEngine)->score(0, $position, self::balancedRules());

        $this->assertSame($points, $score->placementPoints);
        $this->assertSame($points, $score->totalPoints);
    }

    #[DataProvider('warzoneMultipliers')]
    public function test_warzone_style_uses_the_configured_multiplier_for_each_position(int $position, string $multiplier): void
    {
        $score = (new ScoringEngine)->score(10, $position, self::warzoneRules());

        $this->assertSame($multiplier, $score->placementMultiplier);
    }

    public function test_arewavanta_balanced_scores_ten_kills_in_second_place_as_nineteen_points(): void
    {
        $score = (new ScoringEngine)->score(10, 2, self::balancedRules());

        $this->assertSame('10', $score->killPoints);
        $this->assertSame('9', $score->placementPoints);
        $this->assertSame('19', $score->totalPoints);
    }

    public function test_warzone_style_scores_ten_kills_in_second_place_as_eighteen_points(): void
    {
        $score = (new ScoringEngine)->score(10, 2, self::warzoneRules());

        $this->assertSame('10', $score->killPoints);
        $this->assertSame('1.8', $score->placementMultiplier);
        $this->assertSame('18.0', $score->totalPoints);
    }

    #[DataProvider('positions')]
    public function test_a_team_with_no_kills_earns_zero_in_multiplier_mode_at_every_position(int $position): void
    {
        $score = (new ScoringEngine)->score(0, $position, self::warzoneRules());

        $this->assertSame('0', $score->totalPoints);
    }

    public function test_kills_only_ignores_placement_tiers_and_scores_using_the_kill_value(): void
    {
        $rules = new ScoringRules(ScoringMode::KillsOnly, '1.25', 25, []);

        $score = (new ScoringEngine)->score(8, 25, $rules);

        $this->assertSame('10', $score->totalPoints);
        $this->assertNull($score->placementPoints);
        $this->assertNull($score->placementMultiplier);
    }

    public function test_placement_only_ignores_kills(): void
    {
        $rules = self::balancedRules(ScoringMode::PlacementOnly);

        $score = (new ScoringEngine)->score(99, 3, $rules);

        $this->assertSame('7', $score->totalPoints);
        $this->assertSame('0', $score->killPoints);
    }

    public function test_custom_decimal_rules_are_multiplied_without_float_rounding(): void
    {
        $rules = new ScoringRules(
            ScoringMode::Multiplier,
            '1.25',
            1,
            [new PlacementTier(1, 1, null, '1.80')],
        );

        $score = (new ScoringEngine)->score(10, 1, $rules);

        $this->assertSame('12.5', $score->killPoints);
        $this->assertSame('22.5', $score->totalPoints);
    }

    public function test_negative_team_kills_are_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);

        (new ScoringEngine)->score(-1, 1, self::balancedRules());
    }

    public function test_placement_outside_the_scoring_range_is_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);

        (new ScoringEngine)->score(10, 101, self::balancedRules());
    }

    public function test_arewavanta_balanced_awards_zero_fallback_points_beyond_position_twenty_five(): void
    {
        $score = (new ScoringEngine)->score(10, 26, self::balancedRules());

        $this->assertSame('0', $score->placementPoints);
        $this->assertSame('10', $score->totalPoints);
    }

    public function test_warzone_style_rejects_positions_beyond_its_defined_tiers(): void
    {
        $this->expectException(InvalidArgumentException::class);

        (new ScoringEngine)->score(10, 26, self::warzoneRules());
    }

    #[DataProvider('invalidRuleSets')]
    public function test_incomplete_or_unsafe_custom_rules_are_rejected(array $tiers, string $killPointValue = '1'): void
    {
        $this->expectException(InvalidArgumentException::class);

        new ScoringRules(
            ScoringMode::Additive,
            $killPointValue,
            3,
            array_map(static fn (array $tier): PlacementTier => new PlacementTier(...$tier), $tiers),
        );
    }

    /** @return array<string, array{int, string}> */
    public static function balancedPlacementPoints(): array
    {
        $points = [12, 9, 7, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

        return array_combine(
            array_map(static fn (int $position): string => 'position_'.$position, range(1, 25)),
            array_map(static fn (int $position, int $points): array => [$position, (string) $points], range(1, 25), $points),
        );
    }

    /** @return array<string, array{int, string}> */
    public static function warzoneMultipliers(): array
    {
        $multipliers = [
            ...array_fill(0, 1, '2.0'),
            ...array_fill(0, 4, '1.8'),
            ...array_fill(0, 5, '1.6'),
            ...array_fill(0, 10, '1.4'),
            ...array_fill(0, 5, '1.2'),
        ];

        return array_combine(
            array_map(static fn (int $position): string => 'position_'.$position, range(1, 25)),
            array_map(static fn (int $position, string $multiplier): array => [$position, $multiplier], range(1, 25), $multipliers),
        );
    }

    /** @return array<string, array{int}> */
    public static function positions(): array
    {
        return array_combine(
            array_map(static fn (int $position): string => 'position_'.$position, range(1, 25)),
            array_map(static fn (int $position): array => [$position], range(1, 25)),
        );
    }

    /** @return array<string, array{list<array{int, int, string|null, string|null}>, string}> */
    public static function invalidRuleSets(): array
    {
        return [
            'gap' => [[[1, 1, '1', null], [3, 3, '1', null]], '1'],
            'overlap' => [[[1, 2, '1', null], [2, 3, '1', null]], '1'],
            'range_exceeds_maximum' => [[[1, 4, '1', null]], '1'],
            'negative_value' => [[[1, 3, '1', null]], '-1'],
            'excessive_precision' => [[[1, 3, '1', null]], '1.001'],
        ];
    }

    private static function balancedRules(ScoringMode $mode = ScoringMode::Additive): ScoringRules
    {
        return new ScoringRules(
            $mode,
            '1',
            25,
            [
                new PlacementTier(1, 1, '12'),
                new PlacementTier(2, 2, '9'),
                new PlacementTier(3, 3, '7'),
                new PlacementTier(4, 4, '5'),
                new PlacementTier(5, 5, '4'),
                new PlacementTier(6, 7, '3'),
                new PlacementTier(8, 10, '2'),
                new PlacementTier(11, 15, '1'),
                new PlacementTier(16, 25, '0'),
            ],
            '0',
        );
    }

    private static function warzoneRules(): ScoringRules
    {
        return new ScoringRules(
            ScoringMode::Multiplier,
            '1',
            25,
            [
                new PlacementTier(1, 1, null, '2.0'),
                new PlacementTier(2, 5, null, '1.8'),
                new PlacementTier(6, 10, null, '1.6'),
                new PlacementTier(11, 20, null, '1.4'),
                new PlacementTier(21, 25, null, '1.2'),
            ],
        );
    }
}
