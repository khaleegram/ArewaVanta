<?php

namespace App\Http\Requests;

use App\Enums\Role;
use App\Enums\RoleScope;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class ScoringConfigurationRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();

        return $user !== null && ($user->isPlatformAdmin() || $user->hasRole(Role::Organizer, RoleScope::Global, '*'));
    }

    /** @return array<string, array<mixed>|string|ValidationRule> */
    public function rules(): array
    {
        $decimal = ['string', 'regex:/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/D'];

        return [
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'rules' => ['required', 'array'],
            'rules.mode' => ['required', Rule::in(['additive', 'multiplier', 'kills_only', 'placement_only'])],
            'rules.kill_point_value' => ['required', ...$decimal],
            'rules.maximum_position' => ['required', 'integer', 'min:1', 'max:100'],
            'rules.fallback_placement_points' => ['sometimes', 'nullable', ...$decimal],
            'rules.fallback_multiplier' => ['sometimes', 'nullable', ...$decimal],
            'rules.tiers' => ['present', 'array', 'list', 'max:100'],
            'rules.tiers.*.position_from' => ['required', 'integer', 'min:1', 'max:100'],
            'rules.tiers.*.position_to' => ['required', 'integer', 'min:1', 'max:100'],
            'rules.tiers.*.placement_points' => ['sometimes', 'nullable', ...$decimal],
            'rules.tiers.*.multiplier' => ['sometimes', 'nullable', ...$decimal],
            'team_kills' => ['sometimes', 'integer', 'min:0', 'max:9990'],
            'placement' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }
}
