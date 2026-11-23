<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class AssistantMessageRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'client_id' => ['required', 'uuid'],
            'message' => ['nullable', 'required_without_all:images,csv_files,recheck_evidence_ids', 'string', 'max:12000'],
            'match_id' => ['nullable', 'ulid'],
            'images' => ['sometimes', 'array', 'min:1', 'max:40'],
            'images.*' => ['required', 'file', 'image', 'mimes:jpeg,png,webp', 'max:5120', 'dimensions:max_width=6000,max_height=6000'],
            'csv_files' => ['sometimes', 'array', 'min:1', 'max:2'],
            'csv_files.*' => ['required', 'file', 'extensions:csv', 'mimetypes:text/csv,text/plain,text/x-csv,application/csv,application/vnd.ms-excel,text/tab-separated-values,application/octet-stream', 'max:1024'],
            'recheck_evidence_ids' => ['sometimes', 'array', 'min:1', 'max:8'],
            'recheck_evidence_ids.*' => ['required', 'ulid', 'distinct:strict'],
        ];
    }
}
