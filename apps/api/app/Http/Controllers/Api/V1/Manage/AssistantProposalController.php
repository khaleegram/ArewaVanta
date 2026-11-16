<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\Assistant\AssistantProposals;
use App\Http\Controllers\Controller;
use App\Models\AssistantProposal;
use App\Models\AssistantThread;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class AssistantProposalController extends Controller
{
    public function update(Request $request, AssistantThread $thread, AssistantProposal $proposal, AssistantProposals $proposals, OrganizerAssistantController $chat): JsonResponse
    {
        $data = $request->validate(['decision' => ['required', Rule::in(['accept', 'reject'])]]);
        $proposals->decide($request->user(), $thread, $proposal, $data['decision']);

        return $chat->response($thread->refresh());
    }
}
