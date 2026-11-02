<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class SaveCompetitionSlotsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'expected_version' => ['required', 'string', 'size:64'],
            'slots' => ['required', 'array', 'min:1', 'max:25'],
            'slots.*.slot' => ['required', 'integer', 'min:1', 'max:25', 'distinct:strict'],
            'slots.*.squad_id' => ['nullable', 'string', Rule::exists('squads', 'id')],
            'slots.*.reserved_clan_id' => ['nullable', 'string', Rule::exists('clans', 'id')],
        ];
    }
}
