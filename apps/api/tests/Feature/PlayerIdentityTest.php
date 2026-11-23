<?php

namespace Tests\Feature;

use App\Domain\Competition\PlayerIdentity;
use App\Models\Clan;
use App\Models\Player;
use App\Models\PlayerAlias;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlayerIdentityTest extends TestCase
{
    use RefreshDatabase;

    public function test_tags_misreads_aliases_and_context_resolve_without_new_profiles(): void
    {
        $akatsuki = Clan::factory()->create(['name' => 'AKATSUKI', 'tag' => 'AK']);
        $bagatatas = Clan::factory()->create(['name' => 'BAGATATAS', 'tag' => 'B1']);
        $ismael = Player::factory()->create(['clan_id' => $akatsuki->id, 'current_ign' => 'ISMAEL']);
        $malleri = Player::factory()->create(['clan_id' => $bagatatas->id, 'current_ign' => 'Malleri']);
        $mormoni = Player::factory()->create(['clan_id' => $bagatatas->id, 'current_ign' => 'MORMONI']);
        $susu = Player::factory()->create(['clan_id' => $bagatatas->id, 'current_ign' => 'Susu']);
        PlayerAlias::query()->create(['player_id' => $susu->id, 'alias' => 'MC 日', 'alias_key' => 'mc', 'source' => 'assistant']);

        $identity = new PlayerIdentity;

        $tagged = $identity->resolve('AK✕ISMAEL');
        $this->assertSame($ismael->id, $tagged['player_id']);
        $this->assertSame(PlayerIdentity::MATCHED, $tagged['status']);

        $misread = $identity->resolve('B・Mallen', $bagatatas->id, [$malleri->id, $mormoni->id]);
        $this->assertSame($malleri->id, $misread['player_id']);
        $this->assertContains($misread['status'], [PlayerIdentity::PROBABLE, PlayerIdentity::MATCHED]);

        $this->assertSame($susu->id, $identity->resolve('MC 日', $bagatatas->id)['player_id']);

        $stranger = $identity->resolve('Zxqwvbn', $bagatatas->id, [$malleri->id]);
        $this->assertSame(PlayerIdentity::NEW, $stranger['status']);
        $this->assertNull($stranger['player_id']);

        $this->assertNull($identity->resolve('ISMAEL', $akatsuki->id, [], [$ismael->id])['player_id']);
    }

    public function test_same_name_in_two_clans_and_short_cores_are_settled_by_the_slot(): void
    {
        $a4 = Clan::factory()->create(['name' => 'ALPHA FOUR', 'tag' => 'A4']);
        $prime = Clan::factory()->create(['name' => 'Prime', 'tag' => 'P1']);
        $bagatatas = Clan::factory()->create(['name' => 'BAGATATAS', 'tag' => 'B1']);
        $death = Player::factory()->create(['clan_id' => $a4->id, 'current_ign' => 'Death']);
        $primeDeath = Player::factory()->create(['clan_id' => $prime->id, 'current_ign' => 'DEATH']);
        $mhd = Player::factory()->create(['clan_id' => $bagatatas->id, 'current_ign' => 'MHD.rnx']);

        $identity = new PlayerIdentity;

        $this->assertSame($death->id, $identity->resolve('A4〆DËÂTH', $a4->id, [$death->id])['player_id']);
        $this->assertSame($primeDeath->id, $identity->resolve('P1・DEATH', $prime->id, [$primeDeath->id])['player_id']);
        $this->assertSame($mhd->id, $identity->resolve('◇MHD◇', $bagatatas->id, [$mhd->id])['player_id']);
    }
}
