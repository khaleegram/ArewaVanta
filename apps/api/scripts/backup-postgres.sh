#!/bin/sh
set -eu

backup_dir=${1:-/backups}
database=${PGDATABASE:-${DB_DATABASE:-}}
host=${PGHOST:-${DB_HOST:-}}
port=${PGPORT:-${DB_PORT:-5432}}
username=${PGUSER:-${DB_USERNAME:-}}

if [ -z "$database" ] || [ -z "$host" ] || [ -z "$username" ]; then
    printf '%s\n' 'Set PG* or DB_* connection variables before creating a backup.' >&2
    exit 2
fi

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
umask 077
export PGPASSWORD=${PGPASSWORD:-${DB_PASSWORD:-}}
export PGSSLMODE=${PGSSLMODE:-${DB_SSLMODE:-prefer}}

timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
backup_file="$backup_dir/arewavanta-$timestamp.dump"

pg_dump \
    --host="$host" \
    --port="$port" \
    --username="$username" \
    --dbname="$database" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file="$backup_file"

pg_restore --list "$backup_file" >/dev/null
(cd "$backup_dir" && sha256sum "$(basename "$backup_file")" > "$(basename "$backup_file").sha256")
chmod 600 "$backup_file" "$backup_file.sha256"

printf 'Backup archive created and checked: %s\n' "$backup_file"
