<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class ChangeMatchScoringRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /** @return array<string, array<mixed>|string|ValidationRule> */
    public function rules(): array
    {
        return ['scoring_rule_version_id' => ['required', 'ulid', Rule::exists('scoring_rule_versions', 'id')]];
    }
}
