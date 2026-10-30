<?php

namespace App\Domain\Scoring;

final readonly class ScoreBreakdown
{
    public function __construct(
        public ScoringMode $mode,
        public int $teamKills,
        public int $placement,
        public string $killPoints,
        public ?string $placementPoints,
        public ?string $placementMultiplier,
        public string $totalPoints,
    ) {}

    /**
     * @return array{mode: string, team_kills: int, placement: int, kill_points: string, placement_points: string|null, placement_multiplier: string|null, total_points: string}
     */
    public function toArray(): array
    {
        return [
            'mode' => $this->mode->value,
            'team_kills' => $this->teamKills,
            'placement' => $this->placement,
            'kill_points' => $this->killPoints,
            'placement_points' => $this->placementPoints,
            'placement_multiplier' => $this->placementMultiplier,
            'total_points' => $this->totalPoints,
        ];
    }
}
