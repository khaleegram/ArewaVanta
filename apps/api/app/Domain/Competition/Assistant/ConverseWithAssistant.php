<?php

namespace App\Domain\Competition\Assistant;

use App\Domain\Competition\ResultPermissions;
use App\Domain\Competition\ScreenshotImport\ScreenshotImportFailed;
use App\Models\AssistantMessage;
use App\Models\AssistantThread;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Throwable;

final class ConverseWithAssistant
{
    public function __construct(
        private readonly ResultPermissions $permissions,
        private readonly AssistantContext $context,
        private readonly DeepSeekOrganizerAssistant $ai,
        private readonly AssistantProposals $proposals,
        private readonly ReadAssistantCsv $csv,
    ) {}

    /** @param array<string, mixed> $input */
    public function handle(User $actor, AssistantThread $thread, array $input): void
    {
        $started = $this->start($actor, $thread, $input);
        if ($started === null) {
            return;
        }
        [$token, $message] = $started;
        try {
            $deadline = microtime(true) + min(110, 2 * max(10, (int) config('services.deepseek.timeout', 90)));
            $thread->refresh()->load('event');
            $evidence = $thread->evidence()->get();
            $readIds = $message->details['read_evidence_ids'];
            $csvEvidence = $evidence->where('mime', 'text/csv');
            $selectedCsv = $csvEvidence->whereIn('id', $readIds);
            $csvTables = ($selectedCsv->isNotEmpty() ? $selectedCsv : $csvEvidence->take(-1))->pluck('observations')->all();
            $context = $this->context->forEvent($thread->event, $message->details['match_id'], $csvTables);
            $context['proposal_decisions'] = $thread->proposals()->reorder()->orderByDesc('id')->limit(24)->get()
                ->map(fn ($p): array => ['id' => $p->id, 'title' => $p->title, 'status' => $p->status, 'reason' => $p->reason])->all();
            $context['requested_evidence_ids'] = $readIds;
            $images = $evidence->whereIn('id', $readIds)->filter(fn ($item): bool => $item->mime !== 'text/csv')->values()->all();
            $imageReadIds = array_map(fn ($image): string => $image->id, $images);
            $history = $thread->messages()->where('id', '<', $message->id)->where('status', 'completed')
                ->reorder()->orderByDesc('id')->limit(16)->get()->reverse()->map(fn ($m): array => [
                    'role' => $m->role, 'content' => $m->content, 'details' => $m->details,
                ])->values()->all();
            $answer = $this->ai->respond($context, $history, $evidence->map(fn ($e): array => [
                'id' => $e->id, 'name' => $e->name, 'mime' => $e->mime, 'observations' => $e->observations,
            ])->all(), $images, $message->content, $this->remainingTime($deadline));
            if (is_array($answer['lookups'] ?? null) && $answer['lookups'] !== []) {
                abort_unless($this->permissions->canManage($actor, $thread->event), 403);
                $firstPass = $answer;
                $context = $this->context->lookUp($thread->event, $context, $answer['lookups']);
                $context['first_pass_evidence_reads'] = $firstPass['evidence_reads'] ?? [];
                $answer = $this->ai->respond($context, $history, $evidence->map(fn ($e): array => [
                    'id' => $e->id, 'name' => $e->name, 'mime' => $e->mime, 'observations' => $e->observations,
                ])->all(), [], $message->content, $this->remainingTime($deadline));
                $answer['evidence_reads'] = $firstPass['evidence_reads'] ?? [];
            }

            DB::transaction(function () use ($actor, $thread, $token, $message, $answer, $context, $imageReadIds): void {
                $locked = AssistantThread::query()->lockForUpdate()->findOrFail($thread->id);
                abort_unless($locked->processing_token === $token, 409, 'A newer review replaced this request. Reload the chat.');
                abort_unless($this->permissions->canManage($actor, $locked->event), 403);
                $warnings = $this->saveReads($locked, $answer['evidence_reads'] ?? [], $imageReadIds);
                if (is_array($answer['lookups'] ?? null) && $answer['lookups'] !== []) {
                    $warnings[] = 'Further information is still needed. Select the specific game or supply the missing player name in a follow-up.';
                }
                $evidenceIds = $locked->evidence()->pluck('id')->all();
                $findings = $this->findings($answer['findings'] ?? [], $evidenceIds);
                $locked->proposals()->where('status', 'pending')->update(['status' => 'superseded', 'updated_at' => now()]);
                $response = $locked->messages()->create([
                    'role' => 'assistant', 'status' => 'completed', 'content' => mb_substr(trim($answer['reply']), 0, 16000),
                    'details' => [
                        'ruling' => is_string($answer['ruling'] ?? null) ? mb_substr($answer['ruling'], 0, 8000) : '',
                        'findings' => $findings, 'model' => $answer['model'], 'warnings' => $warnings,
                    ],
                ]);
                $warnings = [...$warnings, ...$this->proposals->prepare($locked, $response, $answer['corrections'] ?? [], $context)];
                $response->update(['details' => [...$response->details, 'warnings' => $warnings]]);
                $message->update(['status' => 'completed']);
                $locked->forceFill(['processing_token' => null, 'processing_started_at' => null])->save();
            });
        } catch (Throwable $exception) {
            DB::transaction(function () use ($thread, $token, $message): void {
                $locked = AssistantThread::query()->lockForUpdate()->findOrFail($thread->id);
                if ($locked->processing_token === $token) {
                    $message->update(['status' => 'failed']);
                    $locked->forceFill(['processing_token' => null, 'processing_started_at' => null])->save();
                }
            });
            throw $exception;
        }
    }

    private function remainingTime(float $deadline): int
    {
        $remaining = (int) floor($deadline - microtime(true));
        if ($remaining < 5) {
            throw new ScreenshotImportFailed('The review reached its time limit. Your evidence is saved. Retry with one game or fewer files.');
        }

        return min($remaining, max(10, (int) config('services.deepseek.timeout', 90)));
    }

    /** @param array<string, mixed> $input
     * @return array{string, AssistantMessage}|null
     */
    private function start(User $actor, AssistantThread $thread, array $input): ?array
    {
        $stored = [];
        try {
            return DB::transaction(function () use ($actor, $thread, $input, &$stored): ?array {
                $thread = AssistantThread::query()->lockForUpdate()->findOrFail($thread->id);
                abort_unless((string) $thread->user_id === (string) $actor->id, 404);
                abort_unless($this->permissions->canManage($actor, $thread->event), 403);
                $content = trim($input['message'] ?? '') ?: 'Review the attached evidence and compare it with the saved results.';
                $message = $thread->messages()->where('client_id', $input['client_id'])->first();
                if ($message !== null) {
                    abort_unless($message->content === $content, 409, 'This message ID was already used for a different request. Send a new message.');
                    if ($message->status === 'completed') {
                        return null;
                    }
                }
                $lease = 2 * (int) config('services.deepseek.timeout', 90) + 45;
                abort_if($thread->processing_token !== null && $thread->processing_started_at?->isAfter(now()->subSeconds($lease)), 409, 'This chat is already reviewing a message. Wait for it to finish.');
                $thread->messages()->where('status', 'pending')->update(['status' => 'failed', 'updated_at' => now()]);
                if ($message === null) {
                    abort_if($thread->messages()->count() >= 200, 422, 'Start a new chat to continue. This review and its evidence remain saved.');
                    $files = [...($input['images'] ?? []), ...($input['csv_files'] ?? [])];
                    abort_if(count($files) > 8, 422, 'Attach up to eight files per message, including up to two CSVs.');
                    abort_if(array_sum(array_map(fn (UploadedFile $file): int => (int) $file->getSize(), $files)) > 20 * 1024 * 1024, 422, 'Attach up to 20 MB of files per message.');
                    $references = $input['recheck_evidence_ids'] ?? [];
                    abort_unless($thread->evidence()->whereIn('id', $references)->count() === count($references), 422, 'One of the selected files does not belong to this chat.');
                    $duplicates = [];
                    foreach ($files as $file) {
                        $hash = hash_file('sha256', $file->getRealPath());
                        $evidence = $thread->evidence()->where('sha256', $hash)->first();
                        if ($evidence === null) {
                            abort_if($thread->evidence()->count() >= 24, 422, 'This chat has 24 saved files. Start a new review for additional evidence.');
                            $isCsv = mb_strtolower($file->getClientOriginalExtension()) === 'csv';
                            $parsed = $isCsv ? $this->csv->read($file) : null;
                            $path = $file->store('assistant-evidence/'.$thread->id, 'local');
                            if (! is_string($path)) {
                                throw new ScreenshotImportFailed('The file could not be stored. Retry uploading it.');
                            }
                            $stored[] = $path;
                            $evidence = $thread->evidence()->create([
                                'disk' => 'local', 'path' => $path, 'name' => mb_substr($file->getClientOriginalName(), 0, 200),
                                'mime' => $isCsv ? 'text/csv' : $file->getMimeType(), 'sha256' => $hash, 'observations' => $parsed,
                            ]);
                        } else {
                            $duplicates[] = $file->getClientOriginalName();
                        }
                        $references[] = $evidence->id;
                    }
                    $references = array_values(array_unique($references));
                    abort_if(count($references) > 8, 422, 'Read or recheck up to eight files in one message.');
                    $message = $thread->messages()->create([
                        'client_id' => $input['client_id'], 'role' => 'user', 'status' => 'pending', 'content' => $content,
                        'details' => ['match_id' => $input['match_id'] ?? null, 'read_evidence_ids' => $references, 'duplicate_uploads' => $duplicates],
                    ]);
                    if ($thread->title === 'Result review') {
                        $thread->title = mb_substr($content, 0, 120);
                    }
                } else {
                    $message->update(['status' => 'pending']);
                }
                $token = (string) Str::uuid();
                $thread->forceFill(['processing_token' => $token, 'processing_started_at' => now()])->save();

                return [$token, $message];
            });
        } catch (Throwable $exception) {
            Storage::disk('local')->delete($stored);
            throw $exception;
        }
    }

    /** @param list<string> $readIds
     * @return list<string>
     */
    private function saveReads(AssistantThread $thread, mixed $reads, array $readIds): array
    {
        $warnings = [];
        $seen = [];
        foreach (is_array($reads) ? array_slice($reads, 0, 8) : [] as $read) {
            $validator = Validator::make(is_array($read) ? $read : [], [
                'evidence_id' => ['required', Rule::in($readIds)],
                'observations' => ['required', 'array', 'list', 'min:1', 'max:40'],
                'observations.*' => ['required', 'array:kind,printed_datetime,map,team_number,placement,lobby_teams,team_kills,players,note'],
                'observations.*.kind' => ['required', Rule::in(['personal_result', 'scoreboard', 'other'])],
                'observations.*.printed_datetime' => ['sometimes', 'nullable', 'string', 'max:100'],
                'observations.*.map' => ['sometimes', 'nullable', 'string', 'max:100'],
                'observations.*.team_number' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
                'observations.*.placement' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
                'observations.*.lobby_teams' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
                'observations.*.team_kills' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:999'],
                'observations.*.note' => ['sometimes', 'nullable', 'string', 'max:2000'],
                'observations.*.players' => ['sometimes', 'array', 'list', 'max:100'],
                'observations.*.players.*' => ['required', 'array:name,kills'],
                'observations.*.players.*.name' => ['required', 'string', 'max:150'],
                'observations.*.players.*.kills' => ['present', 'nullable', 'integer', 'min:0', 'max:999'],
            ]);
            if ($validator->fails()) {
                $warnings[] = 'One image read was incomplete or invalid. Recheck that proof before relying on it.';

                continue;
            }
            $data = $validator->validated();
            if (in_array($data['evidence_id'], $seen, true)) {
                $warnings[] = 'The AI returned repeated readings for the same proof. Check that image before accepting its interpretation.';

                continue;
            }
            $observations = array_map(function (array $observation): array {
                foreach (['team_number', 'placement', 'lobby_teams', 'team_kills'] as $field) {
                    $observation[$field] = isset($observation[$field]) ? (int) $observation[$field] : null;
                }
                $players = array_map(fn (array $player): array => ['name' => $player['name'], 'kills' => $player['kills'] === null ? null : (int) $player['kills']], $observation['players'] ?? []);
                $observation['players'] = $players;
                $observation['visible_player_kills'] = array_sum(array_column($players, 'kills'));
                $observation['all_visible_kills_read'] = $players !== [] && ! in_array(null, array_column($players, 'kills'), true);

                return $observation;
            }, $data['observations']);
            $thread->evidence()->findOrFail($data['evidence_id'])->update(['observations' => $observations]);
            $seen[] = $data['evidence_id'];
        }
        if (array_diff($readIds, $seen) !== []) {
            $warnings[] = 'Not every requested image received a complete structured read. Any missing evidence still needs review.';
        }

        return array_values(array_unique($warnings));
    }

    /** @param list<string> $evidenceIds
     * @return list<array<string, mixed>>
     */
    private function findings(mixed $findings, array $evidenceIds): array
    {
        $result = [];
        foreach (is_array($findings) ? array_slice($findings, 0, 40) : [] as $finding) {
            if (! is_array($finding) || ! is_string($finding['text'] ?? null) || ! in_array($finding['kind'] ?? null, ['observed', 'inferred', 'unresolved'], true)) {
                continue;
            }
            $references = array_filter(is_array($finding['evidence_ids'] ?? null) ? $finding['evidence_ids'] : [], is_string(...));
            $result[] = ['kind' => $finding['kind'], 'text' => mb_substr($finding['text'], 0, 4000), 'evidence_ids' => array_values(array_intersect($references, $evidenceIds))];
        }

        return $result;
    }
}
