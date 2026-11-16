<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\Assistant\AssistantCsvImports;
use App\Domain\Competition\Assistant\AssistantProposals;
use App\Http\Controllers\Controller;
use App\Models\AssistantProposal;
use App\Models\AssistantThread;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class AssistantProposalController extends Controller
{
    public function update(Request $request, AssistantThread $thread, AssistantProposal $proposal, AssistantProposals $proposals, AssistantCsvImports $imports, OrganizerAssistantController $chat): JsonResponse
    {
        $data = $request->validate(['decision' => ['required', Rule::in(['accept', 'reject'])]]);
        if (($proposal->payload['kind'] ?? '') === 'csv_import') {
            $imports->decide($request->user(), $thread, $proposal, $data['decision']);
        } else {
            abort_if(isset($proposal->payload['parent_id']), 422, 'Accept the complete CSV review instead of an individual child action.');
            $proposals->decide($request->user(), $thread, $proposal, $data['decision']);
        }

        return $chat->response($thread->refresh());
    }
}
