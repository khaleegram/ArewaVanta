<?php

namespace App\Http\Requests;

use App\Enums\Role;
use App\Enums\RoleScope;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class StoreCompetitionEventRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();

        return $user !== null
            && ($user->isPlatformAdmin() || $user->hasRole(Role::Organizer, RoleScope::Global, '*'));
    }

    /** @return array<string, array<mixed>|string|ValidationRule> */
    public function rules(): array
    {
        $scheduleRules = (new UpdateEventScheduleRequest)->rules();
        $scheduleRules['days'] = ['sometimes', 'required', 'array', 'list', 'min:1', 'max:14'];
        $scheduleRules['days.*.id'] = ['prohibited'];
        $scheduleRules['days.*.games.*.id'] = ['prohibited'];

        return [
            ...$scheduleRules,
            'title' => ['required', 'string', 'max:180'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'competition_type' => ['sometimes', 'nullable', Rule::in(['scrim', 'league', 'tournament'])],
            'competition_template_id' => ['sometimes', 'required', 'ulid', Rule::exists('competition_templates', 'id')],
            'season_id' => ['sometimes', 'nullable', 'ulid', Rule::exists('seasons', 'id')],
            'scoring_rule_version_id' => ['sometimes', 'nullable', 'ulid', Rule::exists('scoring_rule_versions', 'id')],
            'dates' => ['sometimes', 'required', 'array', 'list', 'min:1', 'max:14'],
            'dates.*' => ['required', 'date_format:Y-m-d', 'distinct:strict'],
            'squad_ids' => ['prohibited'],
            'timezone' => ['sometimes', 'required', 'timezone'],
            'maximum_position' => ['sometimes', 'required', 'integer', 'min:1', 'max:100'],
            'squad_size' => ['sometimes', 'required', 'integer', 'min:1', 'max:10'],
            'squad_capacity' => ['sometimes', 'required', 'integer', 'min:1', 'max:25'],
            'visibility' => ['sometimes', 'required', Rule::in(['public', 'private'])],
        ];
    }
}
