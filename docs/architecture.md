# ArewaVanta backend architecture

ArewaVanta uses one Laravel API and one PostgreSQL database. Its competition engine records human-entered results and calculates scores; it does not control CODM or retrieve game data.

## Data and modules

| Area | Main tables | Purpose |
|---|---|---|
| Identity | `users`, `role_assignments` | Sanctum authentication and practical platform, event, and clan access |
| Teams | `clans`, `squads`, `players`, `squad_memberships` | Clan identities, independent squad entries, and reusable rosters |
| Configuration | `seasons`, `competition_templates`, template days/games, scoring presets, versions and tiers | Reusable schedules and exact decimal scoring rules |
| Competitions | `events`, `event_days`, `matches`, `event_squads`, `match_squads` | Automatically generated games and editable participation |
| Results | `match_result_revisions`, `match_squad_results`, `revision_player_results` | Match-level placements, player kills, and computed points |

The legacy result table names and pointer column are retained to preserve existing installations. The API exposes a single current result per match. Saving again updates that result transactionally; legacy records remain stored and older unfinished sheets can be reopened and saved directly. They do not require approval or a reason.

Events, days, and games use soft deletion. Their records and saved scores remain available in storage, while removed items are excluded from current standings and public statistics. Active schedule date and game-order uniqueness is enforced with partial indexes.

## Access and workflow

- **Platform admin:** manages platform roles and has organizer access.
- **Organizer:** creates and edits competitions, squads, configurations, and results. Event-scoped assignments limit access to assigned competitions.
- **Clan captain:** manages their own clan, squads, and roster.
- **Visitor:** reads public competition results and rankings.

Events are available immediately after creation. A result save validates squad assignment, participant eligibility, unique placements and players, and non-negative integer kills; it derives team kills and points on the server. A short roster is valid without a separate confirmation. Changes to squads, schedule, or scoring update the applicable results and standings without an approval chain.

## Scoring and standings

`ScoringEngine` uses `brick/math` decimal arithmetic. The default ArewaVanta Placement + Kills preset awards one point per kill plus placement points. Kills Only and Placement Only remain available. The retired Warzone-Style preset is hidden from new choices while saved historical results retain their original rule snapshots. Built-in presets remain read-only; organizers can clone and configure their own. Match snapshots identify the rules used, and editing a match or event's scoring recalculates its current result in the same transaction.

Event and season standings sum current match scores without normalization. Tie-breaks use total kills, wins, then placement sums over games shared by every squad in the tied group; otherwise the tie remains. Player kills and appearances use current results only. Public season standings include public events in that season.

## Weekly scrim recurrence

`competition_series` groups weekly `events` through `series_id` and a unique `series_week_date`. Scrims are recurring by default. Creation accepts the complete `days` schedule and initializes the series after that schedule has been saved, in one transaction. The scheduler adopts legacy scrims without a series automatically, retaining their existing occurrence and slot assignments. Explicit leagues and tournaments remain independent competitions. `ManageWeeklyScrims` serializes recurrence changes and generation under a series row lock. It copies the latest occurrence's schedule, map configuration and scoring snapshots into fresh games, excluding squad entries, submissions and result pointers. Skipped occurrences retain their data and optional public reason. A skip source distinguishes manual skips from series pauses so resuming does not undo an organizer's individual skips or historical breaks.

`competitions:generate-weeks` runs hourly through Laravel's scheduler, preparing the next fourteen days without backfilling past weeks. Both Compose configurations include a scheduler process using the same application and database. Start that service with the API; other hosting setups must run Laravel's scheduler. Recurrence uses one API mutation, `PATCH /api/v1/manage/events/{event}/recurrence`, for start, pause, resume, end, skip and restore. These actions require global organizer/admin or organizer access scoped to that event. Captain submissions and result saves reject skipped weeks, which remain visible with a notice on the public competition page.

Competition organizers can invite additional organizers for one event from its management screen. The API stores only a hash of each single-use invitation token, expires invitations after seven days, and grants the accepted account an event-scoped organizer role. `POST /api/v1/manage/events/{event}/organizer-invitations` sends the branded email; the public inspect and accept endpoints let the recipient create an account or prove an existing account with its password. An event-scoped role does not grant access to other competitions.

## Migration and test safety

The forward migration preserves existing events, result rows, IDs, and rule configuration. It renames the built-in preset and template for display, gives existing scorekeepers equivalent organizer access in their former scope, and retains the old assignment records. The old database slugs and column names are intentionally unchanged.

Tests default to an in-memory SQLite database. PostgreSQL tests explicitly use the separate `aga_test` database. The application and tests do not need background workers or additional services for result calculation.

## Public API and production runtime

Public event, ranking, directory, and squad-history reads are served by the same Laravel API. Player and clan search has a 30-request-per-minute per-IP limit; other public reads have a 120-request-per-minute limit. Authentication and invitation endpoints also have specific limits. These use Laravel's configured cache store; Redis is not required. Password recovery uses Laravel's 60-minute, one-use hashed reset tokens and sends a branded email through the existing mail transport. Unknown and known email addresses receive the same public response, and a successful reset revokes existing Sanctum tokens.

The local Compose file remains development-only. `compose.production.yaml` runs PHP-FPM, PostgreSQL on a non-published private network, an API-only Nginx FastCGI gateway, and Caddy as the public TLS edge for `api.arewavanta.com`. The React frontend is hosted separately on Vercel and is not built or served by this backend stack. PHP-FPM uses a private FastCGI port; Caddy alone publishes HTTP/HTTPS. Release migrations are run explicitly after a backup. Container logs go to stdout/stderr and health checks separately cover PHP-FPM, the API gateway `/up`, and PostgreSQL readiness. No user file uploads currently need persistent object storage.

PostgreSQL backup, archive verification, and guarded restore scripts are under `apps/api/scripts`. The restore tool requires target confirmation and an additional explicit target match for production. The current single-host layout is low-cost but not highly available; off-host encrypted backups and scheduled restore rehearsals remain operational requirements. See the root README for environment v
alues, launch procedure, cost estimates, DNS, TLS, backup, and rollback guidance.

### Squad and individual kill recording

`events.track_player_kills` controls result entry. Scrims default to squad totals; leagues and tournaments default to individual player kills. Organizers can change it in competition details. For recurring scrims the setting applies across the series and is inherited by new weeks. Squad-only results accept placement and `team_kills` without requiring players or memberships. Individual results derive squad kills from selected player kills. Switching the setting preserves saved squad scores and existing player records; public player rankings, profiles and match breakdowns exclude individual statistics while tracking is disabled. Player ranking responses also include best-game kills, avoiding one profile request per ranking row.

### Organizer workspace

The management navigation includes `/manage/organizers` alongside competitions and the clan/player directory. A competition selector groups weekly scrims into one series. The protected `GET /api/v1/manage/events/{event}/organizers` endpoint lists users with competition or global organizer access and outstanding invitations, with expiry status and no invitation secrets. Resending an invitation replaces pending links across that series. Event-scoped organizers can open their assigned competitions and organizer workspace; creating competitions still requires global organizer or administrator access.
