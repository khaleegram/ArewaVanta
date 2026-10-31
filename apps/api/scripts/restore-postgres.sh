#!/bin/sh
set -eu

backup_file=${1:-}
target_database=${2:-}

if [ -z "$backup_file" ] || [ -z "$target_database" ] || [ ! -f "$backup_file" ]; then
    printf '%s\n' 'Usage: restore-postgres.sh <backup.dump> <existing-target-database>' >&2
    exit 2
fi

case "$target_database" in
    ''|*[!A-Za-z0-9_]* )
        printf '%s\n' 'The target must be a database name containing only letters, numbers, and underscores.' >&2
        exit 2
        ;;
esac

if [ "${APP_ENV:-}" = production ] && [ "${ALLOW_PRODUCTION_RESTORE:-}" != "$target_database" ]; then
    printf '%s\n' 'Production restore blocked. Set ALLOW_PRODUCTION_RESTORE to the exact target database name after reviewing the backup.' >&2
    exit 3
fi

if [ "${RESTORE_TARGET_CONFIRMATION:-}" != "$target_database" ]; then
    if [ ! -t 0 ]; then
        printf 'Restore blocked. Re-run interactively and type RESTORE %s, or set RESTORE_TARGET_CONFIRMATION to that exact target name after reviewing it.\n' "$target_database" >&2
        exit 3
    fi

    printf 'This replaces all objects in database "%s". Type "RESTORE %s" to continue: ' "$target_database" "$target_database" >&2
    IFS= read -r confirmation
    if [ "$confirmation" != "RESTORE $target_database" ]; then
        printf '%s\n' 'Confirmation did not match; no restore was started.' >&2
        exit 3
    fi
fi

"$(dirname -- "$0")/verify-postgres-backup.sh" "$backup_file"
host=${PGHOST:-${DB_HOST:-}}
port=${PGPORT:-${DB_PORT:-5432}}
username=${PGUSER:-${DB_USERNAME:-}}
if [ -z "$host" ] || [ -z "$username" ]; then
    printf '%s\n' 'Set PG* or DB_* connection variables before restoring a backup.' >&2
    exit 2
fi

export PGPASSWORD=${PGPASSWORD:-${DB_PASSWORD:-}}
export PGSSLMODE=${PGSSLMODE:-${DB_SSLMODE:-prefer}}
pg_restore \
    --host="$host" \
    --port="$port" \
    --username="$username" \
    --dbname="$target_database" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    --single-transaction \
    "$backup_file"

printf 'Backup restored to database "%s". Verify the application before switching traffic.\n' "$target_database"
