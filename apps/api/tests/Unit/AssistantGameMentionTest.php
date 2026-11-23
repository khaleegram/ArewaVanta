<?php

namespace Tests\Unit;

use App\Domain\Competition\Assistant\AssistantGameMention;
use PHPUnit\Framework\TestCase;

class AssistantGameMentionTest extends TestCase
{
    private function schedule(): array
    {
        $schedule = [];
        foreach (['2026-11-21' => 'a', '2026-11-22' => 'b'] as $date => $key) {
            foreach ([1, 2, 3] as $game) {
                $schedule[] = ['id' => $key.$game, 'date' => $date, 'game' => $game];
            }
        }

        return $schedule;
    }

    public function test_names_a_game_by_date_and_number(): void
    {
        $this->assertSame('b1', AssistantGameMention::find('22 nd nov 1st game', $this->schedule()));
        $this->assertSame('a2', AssistantGameMention::find('Here is 2nd game 21 nov', $this->schedule()));
        $this->assertSame('b3', AssistantGameMention::find('sunday game 3', $this->schedule()));
    }

    public function test_ambiguous_or_missing_mentions_return_null(): void
    {
        $this->assertNull(AssistantGameMention::find('enter this game', $this->schedule()));
        $this->assertNull(AssistantGameMention::find('1st game', $this->schedule()));
        $this->assertNull(AssistantGameMention::find('Sorry my bad here its', $this->schedule()));
    }
}
