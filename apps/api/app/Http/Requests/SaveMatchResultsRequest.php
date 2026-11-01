<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class SaveMatchResultsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'expected_lock_version' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'expected_scoring_version_id' => ['sometimes', 'nullable', 'ulid'],
            'results' => ['required', 'array', 'list', 'min:1', 'max:100'],
            'results.*.squad_id' => ['required', 'ulid', 'distinct:strict', Rule::exists('squads', 'id')],
            'results.*.status' => ['sometimes', Rule::in(['present', 'absent'])],
            'results.*.placement' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
            'results.*.team_kills' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:999'],
            'results.*.players' => ['sometimes', 'array', 'list', 'max:10'],
            'results.*.players.*.player_id' => ['required', 'ulid', Rule::exists('players', 'id')],
            'results.*.players.*.kills' => ['required', 'integer', 'min:0', 'max:999'],
        ];
    }
}
