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

`ScoringEngine` uses `brick/math` decimal arithmetic. ArewaVanta Balanced, Warzone-Style Multiplier, Kills Only, and Placement Only are seeded. Built-in presets remain read-only; organizers can clone and configure their own. Match snapshots identify the rules used, and editing a match or event's scoring recalculates its current result in the same transaction.

Event and season standings sum current match scores without normalization. Tie-breaks use total kills, wins, then placement sums over games shared by every squad in the tied group; otherwise the tie remains. Player kills and appearances use current results only. Public season standings include public events in that season.

## Migration and test safety

The forward migration preserves existing events, result rows, IDs, and rule configuration. It renames the built-in preset and template for display, gives existing scorekeepers equivalent organizer access in their former scope, and retains the old assignment records. The old database slugs and column names are intentionally unchanged.

Tests default to an in-memory SQLite database. PostgreSQL tests explicitly use the separate `aga_test` database. The application and tests do not need background workers or additional services for result calculation.
