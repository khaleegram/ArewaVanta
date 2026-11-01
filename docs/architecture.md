# ArewaVanta backend architecture

ArewaVanta uses one Laravel API and one PostgreSQL database. Its competition engine records human-entered results and calculates scores; it does not control CODM or retrieve game data.

## Data and modules

| Area | Main tables | Purpose |
|---|---|---|
| Identity | `users`, `role_assignments` | Sanctum authentication and practical platform, event, and clan access |
| Teams | `clans`, `squads`, `players`, `squad_memberships` | Clan identities, independent squad entries, and reusable rosters |
| Configuration | `seasons`, `competition_templates`, template days/games, scoring presets, versions and tiers | Reusable schedules and exact decimal scoring rules |
| Competitions | `events`, `event_days`, `matches`, `event_squads`, `event_squad_submissions`, `match_squads` | Weekly scrim occurrences, captain entries, and editable participation |
| Results | `match_result_revisions`, `match_squad_results`, `revision_player_results` | Match-level placements, player kills, and computed points |

The legacy result table names and pointer column are retained to preserve existing installations. The API exposes a single current result per match. Saving again updates that result transactionally; legacy records remain stored and older unfinished sheets can be reopened and saved directly. They do not require approval or a reason.

Events, days, and games use soft deletion. Their records and saved scores remain available in storage, while removed items are excluded from current standings and public statistics. Active schedule date and game-order uniqueness is enforced with partial indexes.

## Access and workflow

- **Platform admin:** manages platform roles and has organizer access.
- **Organizer:** creates and edits competitions, squads, configurations, and results. Event-scoped assignments limit access to assigned competitions.
- **Clan captain:** manages their own clan, squads, and roster. Any organizer can manage all clans, squads, rosters, and captain assignments; the private captain-management UI presents organizers as “Team captain.”
- **Visitor:** reads public competition results and rankings.

Events are available immediately after creation. A result save validates squad assignment, player identity, and non-negative integer kills, and calculates known points on the server. Organizers can save partial results with missing placements, players, or kills, share placements temporarily, and correct any game later. Actual match participants may be selected or created while scoring without prior roster registration. A short roster is valid without a separate confirmation. Changes to squads, schedule, or scoring update the applicable results and standings without an approval chain.

## Scoring and standings

`ScoringEngine` uses `brick/math` decimal arithmetic. The default ArewaVanta Placement + Kills preset awards one point per kill plus placement points. Kills Only and Placement Only remain available. The retired Warzone-Style preset is hidden from new choices while saved historical results retain their original rule snapshots. Built-in presets remain read-only; organizers can clone and configure their own. Match snapshots identify the rules used, and editing a match or event's scoring recalculates its current result in the same transaction.

Event and season standings sum current match scores without normalization. Tie-breaks use total kills, wins, then placement sums over games shared by every squad in the tied group; otherwise the tie remains. Player kills and appearances use current results only. Public season standings include public events in that season.

## Weekly scrim recurrence

`competition_series` groups weekly `events` through `series_id` and a unique `series_week_date`. Scrims are recurring by default. Creation accepts the complete `days` schedule and initializes the series after that schedule has been saved, in one transaction. The scheduler adopts legacy scrims without a series automatically, retaining their existing occurrence and slot assignments. Explicit leagues and tournaments remain independent competitions. `ManageWeeklyScrims` serializes recurrence changes and generation under a series row lock. It copies the latest occurrence's schedule, map configuration and scoring snapshots into fresh games, excluding squad entries, submissions and result pointers. Skipped occurrences retain their data and optional public reason. A skip source distinguishes manual skips from series pauses so resuming does not undo an organizer's individual skips or historical breaks.

`competitions:generate-weeks` runs every Monday at 00:05 Africa/Lagos through Laravel's scheduler. It prepares only the next weekend after the previous one has ended; it does not stage several empty weeks. Captains see only the nearest upcoming or active entry per weekly scrim, can submit any time before results are published, and can change their roster on Saturday or Sunday. Legacy scrims without a series link are grouped by title to avoid showing duplicate weeks. Other leagues and tournaments remain separate entries. Both Compose configurations include a scheduler process using the same application and database. Start that service with the API; other hosting setups must run Laravel's scheduler. Recurrence uses one API mutation, `PATCH /api/v1/manage/events/{event}/recurrence`, for start, pause, resume, end, skip and restore. These actions require global organizer/admin or organizer access scoped to that event. Captain submissions and result saves reject skipped weeks, which remain visible with a notice on the public competition page.

An organizer invitation can be sent from any competition. The API stores only a hash of each invitation token. Links remain active until accepted; resending does not invalidate links already sent, and accepting one marks all pending invites for that email and event series as used. Acceptance grants the global organizer role, which can manage all competitions, weekly scrims, clans, squads, players, schedules, scoring and results. Platform-administration actions remain restricted to platform administrators. `POST /api/v1/manage/events/{event}/organizer-invitations` sends the branded email; the public inspect and accept endpoints let the recipient create an account or prove an existing account with its password. Existing event-scoped organizer assignments are promoted to global organizer access.

## Migration and test safety

The forward migration preserves existing events, result rows, IDs, and rule configuration. It renames the built-in preset and template for display, gives existing scorekeepers equivalent organizer access in their former scope, and retains the old assignment records. The old database slugs and column names are intentionally unchanged.

Tests default to an in-memory SQLite database. PostgreSQL tests explicitly use the separate `aga_test` database. The application and tests do not need background workers or additional services for result calculation.

## Public API and production runtime

The management clan directory uses expandable clan summaries and compact squad rows with player names inline. Clan editing, captain assignments and squad creation share one toolbar. Captains switch to one weekend-entry panel per clan and select a squad there, rather than repeating the whole submission interface for every squad. Closed clan rows do not load rosters or submissions.

Players retain a clan through `players.clan_id` independently of squad membership. Removing a squad assignment leaves the player in that clan’s unassigned pool. The authenticated clan-player list and roster mutations enforce the target clan; captains cannot select or add another clan’s players by ID. Both the pool and squad editor retain an explicit new-player action. Organizers can choose a player’s clan, and must remove active squad assignments before transferring them. The migration recovers clan links from current or most recent historical squad memberships; conflicting active memberships remain unclaimed for organizer review without deleting history.

Clan-player searches match any part of a name after normalizing accents, punctuation, compatibility fonts and common decorated Latin letters; the clan tag is not required. Normalization only changes matching, and the original IGN stays visible. Filtering takes place inside the authorized clan’s players.

Organizers can open `/manage/competitions/{event}/check-in` from the competition overview or slot manager to print a branded A4 slot and player sheet. Its protected `GET /api/v1/manage/events/{event}/check-in` endpoint returns active event slots and current active clan-owned rosters, without UIDs or account details, using `private, no-store` caching. The selected day labels the sheet; rosters always reflect the latest saved squad memberships. Refreshing resets local verification checkboxes. The sheet includes player checks, team checks, notes, empty-slot summaries and an option to print vacant slots.

Public event, ranking, directory, and squad-history reads are served by the same Laravel API. Player and clan search has a 30-request-per-minute per-IP limit; other public reads have a 120-request-per-minute limit. Authentication and invitation endpoints also have specific limits. These use Laravel's configured cache store; Redis is not required. Password recovery uses Laravel's 60-minute, one-use hashed reset tokens and sends a branded email through the existing mail transport. Unknown and known email addresses receive the same public response, and a successful reset revokes existing Sanctum tokens.

The local Compose file remains development-only. `compose.production.yaml` runs PHP-FPM, PostgreSQL on a non-published private network, an API-only Nginx FastCGI gateway, and Caddy as the public TLS edge for `api.arewavanta.com`. The React frontend is hosted separately on Vercel and is not built or served by this backend stack. PHP-FPM uses a private FastCGI port; Caddy alone publishes HTTP/HTTPS. Release migrations are run explicitly after a backup. Container logs go to stdout/stderr and health checks separately cover PHP-FPM, the API gateway `/up`, and PostgreSQL readiness. No user file uploads currently need persistent object storage.

PostgreSQL backup, archive verification, and guarded restore scripts are under `apps/api/scripts`. The restore tool requires target confirmation and an additional explicit target match for production. The current single-host layout is low-cost but not highly available; off-host encrypted backups and scheduled restore rehearsals remain operational requirements. See the root README for environment v
alues, launch procedure, cost estimates, DNS, TLS, backup, and rollback guidance.

### Squad and individual kill recording

Player kills are always available for every competition. The compatibility `events.track_player_kills` field is set to true, and the create/edit switch has been removed. Organizers select or create actual participants while entering results; an existing guest keeps their permanent clan and squad membership, and a new player gets a public profile without an auth account. Captains’ clan-player and roster endpoints still enforce clan privacy.

Player kills may be null (unknown), and placements and participant lists may be left incomplete. A known team total is optional; otherwise team kills come from the known player scores. The effective total is the larger of that entered total and the player sum, with the discrepancy shown in the UI. Unattributed kills never become guessed player stats. Additive scores include only known kill and placement points; multiplier totals await a placement. The migration preserves legacy team totals wherever individual player details do not explain them, without replacing existing points. Result and profile responses distinguish pending data from zero.

The result manager sends only changed squad rows using `patch_mode`. Unsupplied rows retain their saved data. Version checks prevent silent concurrent overwrites; after a conflict, the organizer can apply their changed squads to a fresh sheet without discarding other squads’ updates. Participant selection moves an already-selected player between squads rather than crediting the same player twice. There is no minimum player count, unique-placement gate, or completion/approval step before saving. Root `AGENTS.md` records this flexibility as a product rule.

### Monthly clan and squad reports

`GET /api/v1/manage/clans/{clan}/reports/monthly?month=YYYY-MM` powers `/manage/clans/{clan}/reports`. Clan captains can access their own clan; organizers can access the clans they manage. Reports use match dates and only each match’s current published result, excluding removed matches/events and obsolete revisions. They include current and previous-month totals, squad comparisons, wins, top-three finishes, placement/kill averages, match-day trends, competitions, per-player contributions, and a per-squad match ledger with actual participants.

The report shows pending placements, unknown player scores and unattributed team kills separately, and counts squad appearances independently from unique games. Player kill averages exclude unknown scores. The UI supports month and squad filters, public player profiles, direct links back to score entry, spreadsheet-safe player/match CSV downloads, and a branded A4 print/PDF layout. Reports are private and never cached; refreshing picks up later corrections. The monthly report link lives in each expanded clan’s toolbar.

### Organizer workspace

The management navigation includes `/manage/organizers` alongside competitions and the clan/player directory. A competition selector groups weekly scrims into one series. The protected `GET /api/v1/manage/events/{event}/organizers` endpoint lists users with competition or global organizer access and outstanding invitations, with expiry status and no invitation secrets. Resending an invitation replaces pending links across that series. Event-scoped organizers can open their assigned competitions and organizer workspace; creating competitions still requires global organizer or administrator access.
