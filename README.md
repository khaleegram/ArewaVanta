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

Public routes include `/api/v1/events`, `/api/v1/events/{slug}/standings`, `/api/v1/matches/{match}/results`, `/api/v1/matches/{match}/standings`, `/api/v1/seasons/{season}/standings`, `/api/v1/clans`, `/api/v1/squads/{slug}`, `/api/v1/players`, `/api/v1/players/{player}`, `/api/v1/rankings/players`, and `/api/v1/scoring-presets`.

Authenticated routes under `/api/v1/manage` provide event creation, editing, deletion, schedule and squad assignment, result entry, scoring presets and previews, templates, seasons, clans, rosters, CSV exports, and platform administration. `php artisan route:list --path=api` lists the current routes. Clan captains manage their own clan and roster; organizers manage competitions; platform admins manage platform roles.

See [architecture](docs/architecture.md) and [product requirements](AGA_Product_Requirements_Document.md). See [the frontend README](apps/web/README.md) for the homepage, rankings preview and frontend setup.
