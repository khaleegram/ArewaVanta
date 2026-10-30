<?php

namespace App\Domain\Scoring;

use Brick\Math\BigDecimal;
use InvalidArgumentException;

final class ScoringEngine
{
    public function score(int $teamKills, int $placement, ScoringRules $rules): ScoreBreakdown
    {
        if ($teamKills < 0) {
            throw new InvalidArgumentException('Team kills cannot be negative.');
        }

        if ($rules->mode === ScoringMode::KillsOnly
            && ($placement < 1 || $placement > $rules->maximumPosition)) {
            throw new InvalidArgumentException('Placement is outside the configured scoring range.');
        }

        $killPoints = $rules->mode === ScoringMode::PlacementOnly
            ? BigDecimal::zero()
            : BigDecimal::of($teamKills)->multipliedBy($rules->killPointValue);
        $placementPoints = null;
        $placementMultiplier = null;

        if ($rules->mode === ScoringMode::KillsOnly) {
            $totalPoints = $killPoints;
        } else {
            $tier = $rules->tierForPosition($placement);

            if ($rules->mode === ScoringMode::Multiplier) {
                $placementMultiplier = $tier->multiplier;
                $totalPoints = $killPoints->multipliedBy($placementMultiplier);
            } elseif ($rules->mode === ScoringMode::PlacementOnly) {
                $placementPoints = $tier->placementPoints;
                $totalPoints = BigDecimal::of($placementPoints);
            } else {
                $placementPoints = $tier->placementPoints;
                $totalPoints = $killPoints->plus($placementPoints);
            }
        }

        return new ScoreBreakdown(
            mode: $rules->mode,
            teamKills: $teamKills,
            placement: $placement,
            killPoints: self::normalize($killPoints),
            placementPoints: $placementPoints === null ? null : self::normalize(BigDecimal::of($placementPoints)),
            placementMultiplier: $placementMultiplier === null ? null : self::normalize(BigDecimal::of($placementMultiplier), 1),
            totalPoints: self::normalize($totalPoints, $rules->mode === ScoringMode::Multiplier ? 1 : 0),
        );
    }

    private static function normalize(BigDecimal $value, int $minimumScale = 0): string
    {
        $normalized = $value->strippedOfTrailingZeros();

        if ($normalized->isZero() || $normalized->getScale() >= $minimumScale) {
            return (string) $normalized;
        }

        return (string) $normalized->toScale($minimumScale);
    }
}
