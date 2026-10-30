<?php

namespace App\Http\Requests;

use App\Enums\Role;
use App\Enums\RoleScope;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class StoreCompetitionTemplateRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();

        return $user !== null && ($user->isPlatformAdmin() || $user->hasRole(Role::Organizer, RoleScope::Global, '*'));
    }

    /** @return array<string, array<mixed>|string|ValidationRule> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120', Rule::unique('competition_templates', 'name')->where('owner_id', $this->user()->id)],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'timezone' => ['sometimes', 'required', 'timezone'],
            'squad_size' => ['sometimes', 'required', 'integer', 'min:1', 'max:10'],
            'maximum_position' => ['sometimes', 'required', 'integer', 'min:1', 'max:100'],
            'default_rule_version_id' => ['required', 'ulid', Rule::exists('scoring_rule_versions', 'id')],
            'days' => ['required', 'array', 'list', 'min:1', 'max:14'],
            'days.*.label' => ['required', 'string', 'max:80'],
            'days.*.games' => ['required', 'array', 'list', 'min:1', 'max:20'],
            'days.*.games.*.map_code' => ['required', 'string', 'max:40'],
            'days.*.games.*.map_label' => ['required', 'string', 'max:80'],
            'days.*.games.*.rule_version_override_id' => ['sometimes', 'nullable', 'ulid', Rule::exists('scoring_rule_versions', 'id')],
        ];
    }
}
