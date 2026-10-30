<?php

namespace App\Domain\Scoring;

use Brick\Math\BigDecimal;
use InvalidArgumentException;

final readonly class ScoringRules
{
    private const MAXIMUM_POSITION_LIMIT = 100;

    private const MAXIMUM_RULE_VALUE = '1000';

    /**
     * @param  list<PlacementTier>  $tiers
     */
    public function __construct(
        public ScoringMode $mode,
        public string $killPointValue,
        public int $maximumPosition,
        public array $tiers,
        public ?string $fallbackPlacementPoints = null,
        public ?string $fallbackMultiplier = null,
    ) {
        self::assertDecimalRuleValue($this->killPointValue, 'Kill point value');

        if ($this->maximumPosition < 1 || $this->maximumPosition > self::MAXIMUM_POSITION_LIMIT) {
            throw new InvalidArgumentException('Maximum position must be between 1 and 100.');
        }

        if ($this->mode === ScoringMode::KillsOnly) {
            if ($this->tiers !== [] || $this->fallbackPlacementPoints !== null || $this->fallbackMultiplier !== null) {
                throw new InvalidArgumentException('Kills-only rules cannot contain placement values.');
            }

            return;
        }

        $this->assertTierCoverage();
    }

    /**
     * @param  array{mode: string, kill_point_value: string, maximum_position: int, tiers: list<array{position_from: int, position_to: int, placement_points?: string|null, multiplier?: string|null}>, fallback_placement_points?: string|null, fallback_multiplier?: string|null}  $data
     */
    public static function fromArray(array $data): self
    {
        $mode = ScoringMode::tryFrom($data['mode'])
            ?? throw new InvalidArgumentException('The scoring mode is not supported.');

        return new self(
            mode: $mode,
            killPointValue: $data['kill_point_value'],
            maximumPosition: (int) $data['maximum_position'],
            tiers: array_map(PlacementTier::fromArray(...), $data['tiers'] ?? []),
            fallbackPlacementPoints: isset($data['fallback_placement_points']) ? (string) $data['fallback_placement_points'] : null,
            fallbackMultiplier: isset($data['fallback_multiplier']) ? (string) $data['fallback_multiplier'] : null,
        );
    }

    /**
     * @return array{mode: string, kill_point_value: string, maximum_position: int, tiers: list<array{position_from: int, position_to: int, placement_points: string|null, multiplier: string|null}>, fallback_placement_points: string|null, fallback_multiplier: string|null}
     */
    public function toArray(): array
    {
        return [
            'mode' => $this->mode->value,
            'kill_point_value' => $this->killPointValue,
            'maximum_position' => $this->maximumPosition,
            'tiers' => array_map(
                static fn (PlacementTier $tier): array => $tier->toArray(),
                $this->tiers,
            ),
            'fallback_placement_points' => $this->fallbackPlacementPoints,
            'fallback_multiplier' => $this->fallbackMultiplier,
        ];
    }

    public function tierForPosition(int $position): PlacementTier
    {
        if ($position < 1 || $position > self::MAXIMUM_POSITION_LIMIT) {
            throw new InvalidArgumentException('Placement is outside the configured scoring range.');
        }

        if ($position > $this->maximumPosition) {
            if ($this->mode === ScoringMode::Multiplier && $this->fallbackMultiplier !== null) {
                return new PlacementTier($position, $position, null, $this->fallbackMultiplier);
            }

            if ($this->mode !== ScoringMode::Multiplier && $this->fallbackPlacementPoints !== null) {
                return new PlacementTier($position, $position, $this->fallbackPlacementPoints);
            }

            throw new InvalidArgumentException('Placement is outside the configured scoring range.');
        }

        foreach ($this->tiers as $tier) {
            if ($position >= $tier->from && $position <= $tier->through) {
                return $tier;
            }
        }

        throw new InvalidArgumentException('No scoring tier covers the supplied placement.');
    }

    private static function assertDecimalRuleValue(string $value, string $label): void
    {
        if (! preg_match('/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/D', $value)) {
            throw new InvalidArgumentException($label.' must be a non-negative decimal with at most two fractional digits.');
        }

        if (BigDecimal::of($value)->isGreaterThan(self::MAXIMUM_RULE_VALUE)) {
            throw new InvalidArgumentException($label.' cannot exceed '.self::MAXIMUM_RULE_VALUE.'.');
        }
    }

    private function assertTierCoverage(): void
    {
        if ($this->tiers === []) {
            throw new InvalidArgumentException('This scoring mode requires placement tiers.');
        }

        $tiers = $this->tiers;
        usort($tiers, static fn (PlacementTier $left, PlacementTier $right): int => $left->from <=> $right->from);

        $expectedPosition = 1;
        foreach ($tiers as $tier) {
            if ($tier->from !== $expectedPosition) {
                throw new InvalidArgumentException('Placement tiers must cover every position without gaps or overlaps.');
            }

            if ($tier->through > $this->maximumPosition) {
                throw new InvalidArgumentException('A placement tier cannot exceed the configured maximum position.');
            }

            $expectedValue = $this->mode === ScoringMode::Multiplier
                ? $tier->multiplier
                : $tier->placementPoints;

            if ($expectedValue === null) {
                throw new InvalidArgumentException('Placement tiers must match the selected scoring mode.');
            }

            self::assertDecimalRuleValue(
                $expectedValue,
                $this->mode === ScoringMode::Multiplier ? 'Placement multiplier' : 'Placement points',
            );

            if (($this->mode === ScoringMode::Multiplier && $tier->placementPoints !== null)
                || ($this->mode !== ScoringMode::Multiplier && $tier->multiplier !== null)) {
                throw new InvalidArgumentException('Placement tiers must only define the value used by the selected mode.');
            }

            $expectedPosition = $tier->through + 1;
        }

        if ($expectedPosition !== $this->maximumPosition + 1) {
            throw new InvalidArgumentException('Placement tiers must cover every position without gaps or overlaps.');
        }

        if ($this->mode === ScoringMode::Multiplier) {
            if ($this->fallbackPlacementPoints !== null) {
                throw new InvalidArgumentException('Multiplier rules cannot define fallback placement points.');
            }

            if ($this->fallbackMultiplier !== null) {
                self::assertDecimalRuleValue($this->fallbackMultiplier, 'Fallback multiplier');
            }

            return;
        }

        if ($this->fallbackMultiplier !== null) {
            throw new InvalidArgumentException('Additive and placement-only rules cannot define a fallback multiplier.');
        }

        if ($this->fallbackPlacementPoints !== null) {
            self::assertDecimalRuleValue($this->fallbackPlacementPoints, 'Fallback placement points');
        }
    }
}
