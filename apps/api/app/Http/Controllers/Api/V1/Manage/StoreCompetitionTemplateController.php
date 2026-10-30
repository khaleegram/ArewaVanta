<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\CreateCompetitionTemplate;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreCompetitionTemplateRequest;
use App\Http\Resources\CompetitionTemplateResource;
use Illuminate\Http\JsonResponse;

final class StoreCompetitionTemplateController extends Controller
{
    public function __invoke(StoreCompetitionTemplateRequest $request, CreateCompetitionTemplate $createTemplate): JsonResponse
    {
        return (new CompetitionTemplateResource($createTemplate->handle($request->user(), $request->validated())))
            ->response()->setStatusCode(201);
    }
}
