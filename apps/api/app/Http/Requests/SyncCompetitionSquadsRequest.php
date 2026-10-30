<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class SyncCompetitionSquadsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /** @return array<string, array<mixed>|string|ValidationRule> */
    public function rules(): array
    {
        return [
            'squad_ids' => ['present', 'array', 'list', 'max:100'],
            'squad_ids.*' => ['required', 'ulid', 'distinct:strict', Rule::exists('squads', 'id')],
        ];
    }
}
