<?php

namespace App\Domain\Competition\Assistant;

use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;

final class ReadAssistantCsv
{
    /** @return array<string, mixed> */
    public function read(UploadedFile $file): array
    {
        $bytes = file_get_contents($file->getRealPath());
        if (! is_string($bytes) || strlen($bytes) > 1024 * 1024) {
            $this->invalid('Use a CSV file up to 1 MB.');
        }
        $text = $this->utf8($bytes);
        $stream = fopen('php://temp', 'w+');
        fwrite($stream, $text);
        rewind($stream);
        try {
            $delimiter = $this->delimiter($stream);
            $headers = null;
            $rows = [];
            $seen = [];
            $duplicates = 0;
            $uneven = 0;
            $record = 0;
            $size = 0;
            while (! feof($stream)) {
                $start = ftell($stream);
                $values = fgetcsv($stream, null, $delimiter, '"', '');
                if ($values === false) {
                    break;
                }
                $record++;
                if ($values === [null] || (count($values) === 1 && trim($values[0]) === '')) {
                    continue;
                }
                $this->validateRecord(substr($text, $start, ftell($stream) - $start), $delimiter, $record);
                if (count($values) > 64) {
                    $this->invalid('CSV record '.$record.' has more than 64 columns. Split the file into smaller tables.');
                }
                foreach ($values as $value) {
                    if (mb_strlen($value) > 2000) {
                        $this->invalid('CSV record '.$record.' contains a cell longer than 2,000 characters. Shorten notes or split the file.');
                    }
                }
                if ($headers === null) {
                    if (count($values) < 2) {
                        $this->invalid('The CSV needs a header row and at least two columns, separated by commas, semicolons or tabs.');
                    }
                    $headers = $values;
                    $size = strlen(json_encode($headers, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));

                    continue;
                }
                if (count($rows) >= 2000) {
                    $this->invalid('Review up to 2,000 CSV rows at a time. Split this file by week or game.');
                }
                $encoded = json_encode($values, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                $row = ['record' => $record, 'values' => $values];
                $hash = hash('sha256', $encoded);
                if (isset($seen[$hash])) {
                    $row['duplicate_of'] = $seen[$hash];
                    $duplicates++;
                } else {
                    $seen[$hash] = $record;
                }
                if (count($values) !== count($headers)) {
                    $uneven++;
                }
                $size += strlen($encoded) + 60;
                if ($size > 300000) {
                    $this->invalid('This CSV contains too much text for one review. Split it by game or remove unused columns.');
                }
                $rows[] = $row;
            }
            if ($headers === null || $rows === []) {
                $this->invalid('The CSV has no data rows. Include a header row followed by the scores to review.');
            }
            $warnings = [];
            $headerKeys = array_map(fn (string $header): string => mb_strtolower(trim($header)), $headers);
            if (in_array('', $headerKeys, true) || count(array_unique($headerKeys)) !== count($headerKeys)) {
                $warnings[] = 'Some column headings are blank or repeated. Confirm their meaning before using ambiguous values.';
            }
            if ($duplicates > 0) {
                $warnings[] = $duplicates.' repeated row(s) flagged. All rows are preserved; only count once when they refer to the same game and participant or slot.';
            }
            if ($uneven > 0) {
                $warnings[] = $uneven.' row(s) have a different column count from the header. Their original cells are preserved; missing cells are unknown.';
            }

            return [
                'kind' => 'csv', 'delimiter' => $delimiter === "\t" ? 'tab' : $delimiter,
                'headers' => $headers, 'rows' => $rows, 'row_count' => count($rows),
                'duplicate_row_count' => $duplicates, 'warnings' => $warnings,
            ];
        } finally {
            fclose($stream);
        }
    }

    private function utf8(string $bytes): string
    {
        if (str_starts_with($bytes, "\xFF\xFE")) {
            if (! mb_check_encoding(substr($bytes, 2), 'UTF-16LE')) {
                $this->invalid('The CSV contains invalid text. Export it as CSV UTF-8 from your spreadsheet.');
            }
            $text = mb_convert_encoding(substr($bytes, 2), 'UTF-8', 'UTF-16LE');
        } elseif (str_starts_with($bytes, "\xFE\xFF")) {
            if (! mb_check_encoding(substr($bytes, 2), 'UTF-16BE')) {
                $this->invalid('The CSV contains invalid text. Export it as CSV UTF-8 from your spreadsheet.');
            }
            $text = mb_convert_encoding(substr($bytes, 2), 'UTF-8', 'UTF-16BE');
        } else {
            $text = str_starts_with($bytes, "\xEF\xBB\xBF") ? substr($bytes, 3) : $bytes;
        }
        if (! mb_check_encoding($text, 'UTF-8') || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $text)) {
            $this->invalid('The file is not a readable CSV. Export it as CSV UTF-8 from your spreadsheet.');
        }

        return $text;
    }

    /** @param resource $stream */
    private function delimiter($stream): string
    {
        $line = '';
        while (($next = fgets($stream)) !== false) {
            if (trim($next) !== '') {
                $line = $next;

                break;
            }
        }
        if (preg_match('/^sep=([,;\t])\s*$/i', rtrim($line, "\r\n"), $match)) {
            return $match[1];
        }
        $delimiter = ',';
        $columns = 0;
        foreach ([',', ';', "\t"] as $candidate) {
            rewind($stream);
            do {
                $header = fgetcsv($stream, null, $candidate, '"', '');
            } while ($header !== false && ($header === [null] || (count($header) === 1 && trim($header[0]) === '')));
            $count = $header === false ? 0 : count($header);
            if ($count > $columns) {
                $delimiter = $candidate;
                $columns = $count;
            }
        }
        rewind($stream);

        return $delimiter;
    }

    private function validateRecord(string $record, string $delimiter, int $number): void
    {
        $state = 'start';
        for ($i = 0, $length = strlen($record); $i < $length; $i++) {
            $char = $record[$i];
            if ($state === 'quoted') {
                if ($char === '"') {
                    if (($record[$i + 1] ?? null) === '"') {
                        $i++;
                    } else {
                        $state = 'closed';
                    }
                }
            } elseif ($char === $delimiter) {
                $state = 'start';
            } elseif ($char === "\r" || $char === "\n") {
                continue;
            } elseif ($char === '"' && $state === 'start') {
                $state = 'quoted';
            } elseif ($char === '"' || ($state === 'closed' && $char !== ' ' && $char !== "\t")) {
                $this->invalid('CSV record '.$number.' has malformed quotes. Re-export it as CSV UTF-8 before uploading.');
            } elseif ($state !== 'closed') {
                $state = 'unquoted';
            }
        }
        if ($state === 'quoted') {
            $this->invalid('CSV record '.$number.' has an unclosed quote. Re-export it as CSV UTF-8 before uploading.');
        }
    }

    private function invalid(string $message): never
    {
        throw ValidationException::withMessages(['csv_files' => $message]);
    }
}
