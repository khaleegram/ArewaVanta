<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\ClanTag;
use App\Domain\Competition\ClanTagRegistry;
use App\Domain\Competition\OrganizationPermissions;
use App\Domain\Competition\PlayerNameSearch;
use App\Domain\Directory\MergePlayerProfiles;
use App\Domain\Notifications\AdminActivity;
use App\Http\Controllers\Controller;
use App\Models\Clan;
use App\Models\Player;
use App\Models\Squad;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class DirectoryController extends Controller
{
    public function updateClan(Request $request, Clan $clan, OrganizationPermissions $permissions, ClanTagRegistry $tagRegistry): JsonResponse
    {
        abort_unless($permissions->canManageClan($request->user(), $clan), 403);
        if (is_string($request->input('name'))) {
            $request->merge(['name' => trim($request->input('name'))]);
        }
        if ($request->exists('tags') || $request->exists('tag')) {
            $tags = ClanTag::normalizeList(
                $request->exists('tags') ? $request->input('tags') : $request->input('tag'),
            );
            $request->merge(['tags' => $tags]);
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120', function (string $attribute, mixed $value, \Closure $fail) use ($clan): void {
                if (Clan::query()->whereKeyNot($clan->id)->whereRaw('LOWER(name) = ?', [Str::lower($value)])->exists()) {
                    $fail('A clan with this name already exists.');
                }
            }],
            'tags' => ['sometimes', 'array', 'max:8'],
            'tags.*' => ['string', 'max:16', 'distinct:strict'],
            'bio' => ['nullable', 'string', 'max:2000'],
        ]);
        if (array_key_exists('tags', $data)) {
            $tagRegistry->assertAvailable($data['tags'], $clan->id);
            $tagRegistry->assign($clan, $data['tags']);
        }
        unset($data['tags']);
        $clan->fill($data)->save();
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' updated '.$clan->name.'.');

        return response()->json(['data' => ['id' => $clan->id, 'name' => $clan->name, 'slug' => $clan->slug, 'tag' => $clan->tag, 'tags' => $clan->tagList(), 'bio' => $clan->bio]]);
    }

    public function updateSquad(Request $request, Squad $squad, OrganizationPermissions $permissions): JsonResponse
    {
        $squad->load('clan');
        abort_unless($permissions->canManageClan($request->user(), $squad->clan), 403);
        if (is_string($request->input('tag'))) {
            $tag = Str::upper(trim($request->input('tag')));
            $request->merge(['tag' => $tag === '' ? null : $tag]);
        }
        $data = $request->validate([
            'name' => ['prohibited'],
            'squad_number' => ['prohibited'],
            'tag' => ['nullable', 'string', 'max:16'],
        ]);
        $squad->fill($data)->save();
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' updated '.$squad->name.'.');

        return response()->json(['data' => [
            'id' => $squad->id, 'clan_id' => $squad->clan_id, 'name' => $squad->name,
            'squad_number' => $squad->squad_number, 'slug' => $squad->slug, 'tag' => $squad->tag,
        ]]);
    }

    public function duplicatePlayers(Request $request, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);

        $players = Player::query()
            ->with('clan:id,name,tag,tags')
            ->withCount('matchResults')
            ->where('status', 'active')
            ->orderBy('created_at')
            ->get();
        $suggestions = [];

        foreach ($players as $player) {
            $candidates = [];
            foreach ($players as $candidate) {
                if ($candidate->id === $player->id) {
                    continue;
                }
                $sameClan = $player->clan_id !== null && $player->clan_id === $candidate->clan_id;
                $playerName = $this->coreName($player);
                $candidateName = $this->coreName($candidate);
                $playerKey = PlayerNameSearch::key($playerName);
                $candidateKey = PlayerNameSearch::key($candidateName);
                if ($playerKey === '' || $candidateKey === '') {
                    continue;
                }
                if (substr($playerKey, 0, 2) !== substr($candidateKey, 0, 2)) {
                    continue;
                }
                $score = PlayerNameSearch::similarity($playerName, $candidateName);
                if ($sameClan) {
                    $score += 0.08;
                }
                $score = min(0.99, $score);
                if ($score < ($sameClan ? 0.75 : 0.82)) {
                    continue;
                }
                $candidateCount = (int) $candidate->match_results_count;
                $playerCount = (int) $player->match_results_count;
                $candidateIsBetter = $candidate->created_at !== null && $player->created_at !== null
                    ? $candidate->created_at->lt($player->created_at)
                    : $candidateCount > $playerCount;
                if (! $candidateIsBetter) {
                    continue;
                }
                $candidates[] = [
                    'id' => $candidate->id,
                    'current_ign' => $candidate->current_ign,
                    'clan' => $candidate->clan?->name,
                    'clan_tag' => $candidate->clan?->tag,
                    'games' => $candidateCount,
                    'match_score' => (int) round($score * 100),
                    'match_reason' => $sameClan ? 'Similar name in the same clan' : 'Similar registered name',
                ];
            }
            usort($candidates, static fn (array $left, array $right): int => $right['match_score'] <=> $left['match_score']);
            if ($candidates === []) {
                continue;
            }
            $suggestions[] = [
                'source' => [
                    'id' => $player->id,
                    'current_ign' => $player->current_ign,
                    'clan' => $player->clan?->name,
                    'clan_tag' => $player->clan?->tag,
                    'games' => (int) $player->match_results_count,
                    'created_at' => $player->created_at?->toIso8601String(),
                ],
                'candidates' => array_slice($candidates, 0, 4),
            ];
        }

        return response()->json(['data' => array_slice($suggestions, 0, 100)]);
    }

    public function mergePlayer(Request $request, Player $player, OrganizationPermissions $permissions, MergePlayerProfiles $merge): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);
        $data = $request->validate([
            'target_id' => ['required', 'ulid', 'exists:players,id'],
        ]);
        $target = Player::query()->findOrFail($data['target_id']);
        $counts = $merge->handle($player, $target);
        app(AdminActivity::class)->record(
            $request->user(),
            $request->user()->name.' merged player '.$player->current_ign.' into '.$target->current_ign.'.',
        );

        return response()->json(['data' => [
            'player' => $this->playerData($target), 'merge' => $counts,
        ]]);
    }

    public function showPlayer(Request $request, Player $player, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);

        return response()->json(['data' => $this->playerData($player)]);
    }

    public function storePlayer(Request $request, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);
        $data = $this->validatedPlayer($request);
        $player = Player::query()->create($data + ['status' => 'active']);
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' registered player '.$player->current_ign.'.');

        return response()->json(['data' => $this->playerData($player)], 201);
    }

    public function updatePlayer(Request $request, Player $player, OrganizationPermissions $permissions): JsonResponse
    {
        abort_unless($permissions->canManageAll($request->user()), 403);
        $player = DB::transaction(function () use ($request, $player): Player {
            $player = Player::query()->lockForUpdate()->findOrFail($player->id);
            $data = $this->validatedPlayer($request, $player);
            if ($data['clan_id'] !== $player->clan_id && $player->squadMemberships()->whereNull('left_at')->exists()) {
                throw ValidationException::withMessages(['clan_id' => 'Remove this player from their current squads before changing clans.']);
            }
            $player->fill($data)->save();

            return $player;
        });
        app(AdminActivity::class)->record($request->user(), $request->user()->name.' updated player '.$player->current_ign.'.');

        return response()->json(['data' => $this->playerData($player)]);
    }

    private function validatedPlayer(Request $request, ?Player $player = null): array
    {
        $uid = $request->exists('uid') ? $request->input('uid') : $player?->normalized_uid;
        $uid = is_string($uid) ? Str::upper(preg_replace('/\s+/u', '', trim($uid))) : $uid;
        if (is_string($request->input('current_ign'))) {
            $request->merge(['current_ign' => trim($request->input('current_ign'))]);
        }
        $request->merge(['uid' => $uid === '' ? null : $uid]);
        $data = $request->validate([
            'current_ign' => ['required', 'string', 'max:100'],
            'clan_id' => ['sometimes', 'nullable', 'ulid', Rule::exists('clans', 'id')],
            'uid' => ['nullable', 'bail', 'string', 'max:64', Rule::unique('players', 'normalized_uid')->ignore($player?->id)],
            'uid_public' => ['sometimes', 'boolean'],
        ]);
        $clanId = $request->exists('clan_id') ? ($data['clan_id'] ?? null) : $player?->clan_id;
        $clan = $clanId === null ? null : Clan::query()->find($clanId);

        return ['clan_id' => $clanId,
            'current_ign' => ClanTag::strip($data['current_ign'], $clan?->tagList() ?? []),
            'normalized_uid' => $data['uid'] ?? null, 'uid_public' => $data['uid_public'] ?? ($player?->uid_public ?? false)];
    }

    private function coreName(Player $player): string
    {
        $name = trim($player->current_ign);
        foreach ($player->clan?->tagList() ?? [] as $tag) {
            if ($tag !== '' && mb_stripos($name, $tag) === 0) {
                $name = trim(mb_substr($name, mb_strlen($tag)));
                break;
            }
        }

        return ClanTag::strip($name, $player->clan?->tagList() ?? []);
    }

    private function playerData(Player $player): array
    {
        return ['id' => $player->id, 'clan_id' => $player->clan_id, 'current_ign' => $player->current_ign, 'uid' => $player->normalized_uid, 'uid_public' => $player->uid_public];
    }
}
