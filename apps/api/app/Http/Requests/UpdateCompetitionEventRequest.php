<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class UpdateCompetitionEventRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /** @return array<string, array<mixed>|string|ValidationRule> */
    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'required', 'string', 'max:180'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'competition_type' => ['sometimes', 'nullable', Rule::in(['scrim', 'league', 'tournament'])],
            'visibility' => ['sometimes', 'required', Rule::in(['public', 'private'])],
            'season_id' => ['sometimes', 'nullable', 'ulid', Rule::exists('seasons', 'id')],
            'scoring_rule_version_id' => ['sometimes', 'required', 'ulid', Rule::exists('scoring_rule_versions', 'id')],
            'timezone' => ['sometimes', 'required', 'timezone'],
            'squad_size' => ['sometimes', 'required', 'integer', 'min:1', 'max:10'],
            'maximum_position' => ['sometimes', 'required', 'integer', 'min:1', 'max:100'],
        ];
    }
}
