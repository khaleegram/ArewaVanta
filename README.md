# ArewaVanta

ArewaVanta is a community competition and leaderboard platform for Call of Duty: Mobile Battle Royale. Organizers create events, assign squads and save manually entered results. The API calculates match scores, event and season standings, and player statistics immediately.

## Local setup

The backend is a Laravel API using PHP 8.4 and PostgreSQL. Docker Compose provides both services:

```sh
cd apps/api
test -f .env || cp .env.example .env
docker compose up --build
```

The API is available at `http://localhost:8000`. PostgreSQL is available locally on port `5434`. Startup installs dependencies, creates an application key if needed, runs migrations, and seeds scoring presets and the default template.

Create the first administrator interactively; the command prompts for the password:

```sh
docker compose exec api php artisan arewavanta:create-admin admin@example.com --name="ArewaVanta Admin"
```

Run checks with:

```sh
docker compose exec api php artisan test --compact
docker compose exec api vendor/bin/pint --format agent
```

The default tests use in-memory SQLite. To run the suite against PostgreSQL, create the dedicated test database once and opt in:

```sh
docker compose exec db createdb -U aga aga_test
docker compose exec -e AREWAVANTA_TEST_DATABASE=pgsql api vendor/bin/phpunit --no-progress
```

The PostgreSQL suite recreates tables in `aga_test`; the development database is `aga`. These database names and the original built-in preset and template slugs remain unchanged to protect existing installations.

## Competition flow

1. Sign in as an organizer and create an event. Supplying a title is enough to use the default template and the next Saturday and Sunday. Dates, squads, scoring, and a season can also be supplied.
2. The default template creates Isolated, Isolated, and Blackout on each day. Use a saved custom template or edit the event schedule to change days, maps, game counts, or per-game scoring.
3. Save a match's results with `PUT /api/v1/manage/matches/{match}/results`. Send `results` as a list of squad IDs, finishing placements, and player IDs with non-negative kills. Omitted squads are treated as absent. A participating squad needs at least one player; short rosters need no special confirmation.
4. Save the same endpoint again to correct a result. Scores and standings update in the same transaction. Changing a game's or event's scoring also recalculates its saved scores.
5. An organizer can edit participants and schedules or delete an event. Deleted events and removed games are retained in storage but excluded from public results, statistics, and standings.

Event creation and editing also accept an optional `description` and `competition_type` (`scrim`, `league`, or `tournament`). Existing events retain empty values until an organizer adds them. Public event summaries include active squad counts; player profiles include current squad memberships alongside their historical match appearances.

The schedule endpoint accepts a `days` list with `date`, `label`, and a `games` list containing `map_code` and `map_label`. Include existing day/game IDs to preserve their identity while reordering; omitting IDs reuses existing positions, and explicitly setting an ID to `null` creates a new record. Games omitted from the replacement schedule are removed from current standings.

## API overview

Public routes include `/api/v1/events`, `/api/v1/events/{slug}/standings`, `/api/v1/matches/{match}/results`, `/api/v1/matches/{match}/standings`, `/api/v1/seasons/{season}/standings`, `/api/v1/clans`, `/api/v1/squads/{slug}`, `/api/v1/squads/{slug}/history`, `/api/v1/players`, `/api/v1/players/{player}`, `/api/v1/rankings/players`, and `/api/v1/scoring-presets`.

Authenticated routes under `/api/v1/manage` provide event creation, editing, deletion, schedule and squad assignment, result entry, scoring presets and previews, templates, seasons, clans, rosters, CSV exports, and platform administration. `php artisan route:list --path=api` lists the current routes. Clan captains manage their own clan and roster; organizers manage competitions; platform admins manage platform roles.

See [architecture](docs/architecture.md) and [product requirements](AGA_Product_Requirements_Document.md). See [the frontend README](apps/web/README.md) for the homepage, rankings preview and frontend setup.

## Production runtime and launch preparation

`apps/api/compose.yaml` remains for local development. The separate `apps/api/compose.production.yaml` is backend-only: it runs the PHP 8.4-FPM API, PostgreSQL on a private Compose network, an Nginx FastCGI gateway for API routes, Caddy for automatic HTTPS on `api.arewavanta.com`, and the Laravel scheduler. It does not build or serve the React frontend; the existing frontend remains on Vercel. Only Caddy publishes ports 80 and 443. The API and PostgreSQL containers have no public ports. The API image does not run `artisan serve`; startup caches production configuration and starts PHP-FPM. Keep the `scheduler` service running so the next scrim week is prepared automatically every Monday after the previous weekend ends. The command also adopts existing scrims, but only creates an occurrence when run on Monday. Database migrations are a deliberate release step, not a container startup action.

The starter environment template is [apps/api/.env.production.example](apps/api/.env.production.example). Copy it to `.env.production` on the API host, replace every placeholder, and restrict it with `chmod 600`. It contains no production secrets. Generate one Laravel key, store it in the host secret store or protected environment file, and keep it stable between releases. Generate `DB_PASSWORD` as a long hex string (for example, `openssl rand -hex 32`) so Compose `.env` interpolation cannot treat special characters as variables. Set `FRONTEND_URL` and `CORS_ALLOWED_ORIGINS` to the exact origin of the already-hosted Vercel site (for example, `https://arewavanta.com`). The existing Vercel project should use `VITE_API_BASE_URL=https://api.arewavanta.com/api/v1`; this points the current frontend at the API and does not move its hosting. Resend SMTP uses `smtp.resend.com:587`, username `resend`, and the API key as `MAIL_PASSWORD`. Use an address on the verified domain for `MAIL_FROM_ADDRESS`.

### Suggested first deployment

This deployment is prepared, not performed. The planned free host is an Oracle Cloud Always Free Linux VM in the account's home region. Oracle currently offers up to 2 OCPUs and 12 GB of Ampere memory within its Always Free compute allowance, plus 200 GB of combined boot/block storage; availability can vary by region. Select the Always Free eligible shape and keep total A1 usage within the allowance. The free account requires periodic use, and Oracle may ask for phone and card verification at signup. Point only the `api.arewavanta.com` DNS A record at the VM's public IP and allow inbound TCP 80/443; leave the root website records pointed at Vercel. Caddy obtains and renews TLS for the API subdomain. Confirm outbound SMTP on port 587 works for Resend.

On the host, from `apps/api`:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
# Edit .env.production and replace every placeholder before continuing.
docker compose --env-file .env.production -f compose.production.yaml build api
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps api php artisan key:generate --show
# Save that generated key into the protected APP_KEY value, then continue.
docker compose --env-file .env.production -f compose.production.yaml up -d db
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps api php artisan migrate --force
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml exec api php artisan arewavanta:create-admin admin@arewavanta.com --name="ArewaVanta Admin"
```

Create the first admin interactively and use a unique password. The API health check confirms PHP-FPM is running, the API gateway reaches Laravel's `/up`, and PostgreSQL has a separate `pg_isready` check. `/up` indicates the application booted; it is not a complete database readiness check. Compose restart policies bring containers back after a host restart. Laravel and Nginx logs go to container stdout/stderr; use `docker compose logs` and host log rotation/retention. Caddy adds HTTPS redirects, HSTS, content-type, frame, referrer and permissions headers. `TRUSTED_PROXIES=*` in the template is safe only for this layout where PHP-FPM is private and Caddy sanitizes forwarded headers; replace it with the hosting proxy's exact addresses if that topology changes.

### Backups, restore and rollback

The PostgreSQL backup scripts live in `apps/api/scripts`. Run them inside the API container so credentials come from its protected environment and custom-format archives land in the host's ignored `apps/api/backups/` directory:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T api /var/www/html/scripts/backup-postgres.sh
docker compose --env-file .env.production -f compose.production.yaml exec api /var/www/html/scripts/verify-postgres-backup.sh /backups/arewavanta-YYYYMMDDTHHMMSSZ.dump
```

Schedule a daily backup during a quiet period, retain at least 14 daily copies, and copy encrypted backups off the application host. The scripts create an unencrypted custom-format archive and checksum; encrypt both together before off-host transfer (for example, with `age`) and store the decryption key separately. Restore first into a separate verification database. Example rehearsal, replacing the archive filename with the verified backup:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T db sh -c 'createdb -U "$POSTGRES_USER" arewavanta_restore_check'
docker compose --env-file .env.production -f compose.production.yaml exec -T \
  -e ALLOW_PRODUCTION_RESTORE=arewavanta_restore_check \
  -e RESTORE_TARGET_CONFIRMATION=arewavanta_restore_check \
  api /var/www/html/scripts/restore-postgres.sh \
  /backups/arewavanta-YYYYMMDDTHHMMSSZ.dump arewavanta_restore_check
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps \
  -e DB_DATABASE=arewavanta_restore_check api php artisan migrate:status
docker compose --env-file .env.production -f compose.production.yaml exec -T db sh -c 'dropdb -U "$POSTGRES_USER" arewavanta_restore_check'
```

The restore script verifies the checksum/archive and requires an exact target confirmation; production additionally requires `ALLOW_PRODUCTION_RESTORE` to equal the target database name. Do not restore directly to the active database for a routine deployment. Check that the rehearsal database exposes the restored competition, roster and standings data before dropping it.

For application rollback, retain the last known-good image/revision and redeploy it without rolling migrations backward. Keep schema changes backward-compatible across one release; if data recovery is needed, take the current backup first and restore the selected archive into a separate database before choosing a recovery target. No deployment or DNS change is part of this phase.

### Environment variables

The production template documents the required values for frontend/API URLs, PostgreSQL, Resend SMTP, exact CORS origins, `APP_KEY`, trusted proxies, logging, rate limits, secure session flags and the public domains. Keep actual credentials in the host's secret manager or a host-only file with mode `600`; never commit `.env.production`, print `docker compose config` in public logs, or pass database/mail passwords as command-line arguments. There are no uploaded user files in the current application, so no object-storage service is required for app media.

### Estimated monthly cost and remaining limits

The target VM and database can stay within Oracle's published Always Free allowances when provisioned inside the home region and kept within the eligible A1 and storage limits. Always Free capacity is not guaranteed in every region. This is a single server, so it is not highly available; encrypted offsite backups remain important. If Always Free capacity is unavailable, stop before creating any paid resource. See [Oracle's Always Free resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) and [what happens after the trial](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-What_Happens_When_the_Promotion_Expires.htm).

Remaining launch checks are external: choose the host/region, set DNS, set real secrets, confirm Resend sender delivery and port 587 egress, complete TLS issuance, schedule offsite backups, run a restore rehearsal, and validate CORS and the reset/invitation emails on the live domains. No production infrastructure, DNS, live email send, or production database has been touched.
