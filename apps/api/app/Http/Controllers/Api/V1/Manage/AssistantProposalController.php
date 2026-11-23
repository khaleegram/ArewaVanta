<?php

namespace App\Http\Controllers\Api\V1\Manage;

use App\Domain\Competition\Assistant\AssistantAdminActions;
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
    public function update(Request $request, AssistantThread $thread, AssistantProposal $proposal, AssistantProposals $proposals, AssistantCsvImports $imports, AssistantAdminActions $admin, OrganizerAssistantController $chat): JsonResponse
    {
        $data = $request->validate(['decision' => ['required', Rule::in(['accept', 'reject', 'undo'])]]);
        if ($data['decision'] === 'undo') {
            abort_if(($proposal->payload['kind'] ?? '') === 'csv_import' || isset($proposal->payload['parent_id']), 422, 'Imports cannot be undone automatically. Ask the assistant for a correction instead.');
            ($proposal->payload['kind'] ?? '') === 'admin_action'
                ? $admin->undo($request->user(), $thread, $proposal)
                : $proposals->undo($request->user(), $thread, $proposal);
        } elseif (($proposal->payload['kind'] ?? '') === 'admin_action') {
            $admin->decide($request->user(), $thread, $proposal, $data['decision']);
        } elseif (($proposal->payload['kind'] ?? '') === 'csv_import') {
            $imports->decide($request->user(), $thread, $proposal, $data['decision']);
        } else {
            abort_if(isset($proposal->payload['parent_id']), 422, 'Accept the complete CSV review instead of an individual child action.');
            $proposals->decide($request->user(), $thread, $proposal, $data['decision']);
        }

        return $chat->response($thread->refresh());
    }

    public function edit(Request $request, AssistantThread $thread, AssistantProposal $proposal, AssistantProposals $proposals, OrganizerAssistantController $chat): JsonResponse
    {
        $data = $request->validate(['edits' => ['required', 'array', 'list', 'max:60']]);
        $proposals->edit($request->user(), $thread, $proposal, $data['edits']);

        return $chat->response($thread->refresh());
    }
}
