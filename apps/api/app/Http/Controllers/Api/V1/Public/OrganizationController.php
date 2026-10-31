<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Http\Controllers\Controller;
use App\Models\Clan;
use App\Models\Squad;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

final class OrganizationController extends Controller
{
    public function clans(Request $request): JsonResponse
    {
        $filters = $request->validate(['search' => ['sometimes', 'nullable', 'string', 'max:100']]);
        $search = Str::lower($filters['search'] ?? '');
        $clans = Clan::query()->with('squads')
            ->when($search !== '', fn ($query) => $query->where(fn ($query) => $query
                ->whereRaw('LOWER(name) LIKE ?', ['%'.$search.'%'])->orWhereRaw('LOWER(tag) LIKE ?', ['%'.$search.'%'])))
            ->orderBy('name')->orderBy('id')->paginate(20);

        return response()->json([
            'data' => $clans->getCollection()->map(fn (Clan $clan): array => $this->clanData($clan))->values(),
            'meta' => ['current_page' => $clans->currentPage(), 'last_page' => $clans->lastPage(), 'total' => $clans->total()],
        ]);
    }

    public function clan(string $clan): JsonResponse
    {
        $model = Clan::query()->with('squads')->where('slug', $clan)->firstOrFail();

        return response()->json(['data' => $this->clanData($model)]);
    }

    public function squad(string $squad): JsonResponse
    {
        $model = Squad::query()->with(['clan.squads:id,clan_id', 'memberships.player'])->where('slug', $squad)->firstOrFail();

        return response()->json(['data' => [
            'id' => $model->id, 'name' => $model->name, 'squad_number' => $model->squad_number,
            'slug' => $model->slug, 'tag' => $model->tag,
            'clan' => [
                'id' => $model->clan->id, 'name' => $model->clan->name, 'slug' => $model->clan->slug,
                'tag' => $model->clan->tag, 'squad_count' => $model->clan->squads->count(),
            ],
            'roster' => $model->memberships->whereNull('left_at')->filter(fn ($membership) => $membership->player->status === 'active')
                ->map(static fn ($membership): array => ['id' => $membership->player->id, 'ign' => $membership->player->current_ign])->values(),
        ]]);
    }

    private function clanData(Clan $clan): array
    {
        return [
            'id' => $clan->id, 'name' => $clan->name, 'slug' => $clan->slug, 'tag' => $clan->tag, 'bio' => $clan->bio,
            'squad_count' => $clan->squads->count(),
            'squads' => $clan->squads->map(static fn (Squad $squad): array => [
                'id' => $squad->id, 'name' => $squad->name, 'squad_number' => $squad->squad_number,
                'slug' => $squad->slug, 'tag' => $squad->tag,
            ])->values(),
        ];
    }
}
