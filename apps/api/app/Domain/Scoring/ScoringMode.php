<?php

namespace App\Domain\Scoring;

enum ScoringMode: string
{
    case Additive = 'additive';
    case Multiplier = 'multiplier';
    case KillsOnly = 'kills_only';
    case PlacementOnly = 'placement_only';
}
