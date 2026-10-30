<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class UpdateEventScheduleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'days' => ['required', 'array', 'list', 'min:1', 'max:14'],
            'days.*.id' => ['sometimes', 'nullable', 'ulid', 'distinct:strict'],
            'days.*.date' => ['required', 'date_format:Y-m-d', 'distinct:strict'],
            'days.*.label' => ['required', 'string', 'max:80'],
            'days.*.games' => ['required', 'array', 'list', 'min:1', 'max:20'],
            'days.*.games.*.id' => ['sometimes', 'nullable', 'ulid', 'distinct:strict'],
            'days.*.games.*.map_code' => ['required', 'string', 'max:40'],
            'days.*.games.*.map_label' => ['required', 'string', 'max:80'],
            'days.*.games.*.scoring_rule_version_id' => ['sometimes', 'nullable', 'ulid', Rule::exists('scoring_rule_versions', 'id')],
        ];
    }
}
