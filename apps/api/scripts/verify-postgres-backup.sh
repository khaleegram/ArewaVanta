#!/bin/sh
set -eu

backup_file=${1:-}
if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
    printf '%s\n' 'Usage: verify-postgres-backup.sh <backup.dump>' >&2
    exit 2
fi

backup_dir=$(CDPATH= cd -- "$(dirname -- "$backup_file")" && pwd)
backup_name=$(basename -- "$backup_file")
checksum="$backup_dir/$backup_name.sha256"
if [ ! -f "$checksum" ]; then
    printf 'Missing checksum file: %s\n' "$checksum" >&2
    exit 2
fi

(cd "$backup_dir" && sha256sum -c "$backup_name.sha256")
pg_restore --list "$backup_file" >/dev/null
printf 'Backup checksum and PostgreSQL archive are valid: %s\n' "$backup_file"
