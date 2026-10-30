<?php

namespace App\Domain\Scoring;

use InvalidArgumentException;

final readonly class PlacementTier
{
    public function __construct(
        public int $from,
        public int $through,
        public ?string $placementPoints = null,
        public ?string $multiplier = null,
    ) {
        if ($this->from < 1 || $this->through < $this->from) {
            throw new InvalidArgumentException('Placement tier bounds must be positive and ordered.');
        }

        if ($this->placementPoints === null && $this->multiplier === null) {
            throw new InvalidArgumentException('A placement tier must define points or a multiplier.');
        }

        if ($this->placementPoints !== null && $this->multiplier !== null) {
            throw new InvalidArgumentException('A placement tier cannot define both points and a multiplier.');
        }
    }

    /**
     * @param  array{position_from: int, position_to: int, placement_points?: string|null, multiplier?: string|null}  $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            from: (int) $data['position_from'],
            through: (int) $data['position_to'],
            placementPoints: isset($data['placement_points']) ? (string) $data['placement_points'] : null,
            multiplier: isset($data['multiplier']) ? (string) $data['multiplier'] : null,
        );
    }

    /**
     * @return array{position_from: int, position_to: int, placement_points: string|null, multiplier: string|null}
     */
    public function toArray(): array
    {
        return [
            'position_from' => $this->from,
            'position_to' => $this->through,
            'placement_points' => $this->placementPoints,
            'multiplier' => $this->multiplier,
        ];
    }
}
