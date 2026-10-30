# ArewaVanta product requirements

**Product:** ArewaVanta Competitive BR Platform  
**Community:** Arewa gaming community  
**Game:** Call of Duty: Mobile, Battle Royale  
**Current direction:** Powerful scoring with simple organizer workflows.

This document reflects the backend simplification request. The file name is retained for existing links.

## Purpose and boundaries

ArewaVanta lets organizers run recurring competitions, clans maintain squads and rosters, and visitors follow games, results, players, and event or season rankings. Organizers enter results from real CODM games manually; team scores and standings are calculated automatically.

The platform does not start games, control lobbies, read live CODM data, extract screenshots, or connect to CODM accounts. Paid entry, wallets, betting, chat, social feeds, streaming, native apps, multi-game support, and SaaS billing are outside scope.

## People and permissions

- **Platform admin:** manages the platform and roles; can also organize competitions.
- **Organizer:** manages events, templates, scoring, squads, matches, and results. Assignments may be limited to a particular event.
- **Clan captain:** manages their own clan, squads, and roster.
- **Visitor:** views public events, teams, players, scores, and rankings without signing in.

Authentication and authorization are enforced by the server. A user may have more than one role. User accounts do not gain competition administration privileges by registering.

## Competition management

Creating an event makes it available immediately and automatically creates its games. The default schedule is Saturday and Sunday, three games per day: Isolated, Isolated, Blackout. Dates, event details, days, game counts, maps, squad assignments, and scoring can be changed. Templates can be saved and reused. A season optionally groups events for cumulative standings.

A clan may have multiple independent squads. Roster members can be reused, and the actual players for each match may differ through substitutions. Organizers can add or remove event or game participants and can delete an event without an approval chain or a reason. Removed events and games must not contribute to current standings; their underlying records are retained.

## Manual results

An organizer opens a game, enters a unique finishing placement and individual kills for each participating squad, and saves. Omitted squads are absent and score zero. Each present squad needs at least one participant; fewer than the usual squad size needs no special approval. Kills are non-negative integers, and a player cannot score for two squads in the same game. Team kills are always derived from player kills.

Saving makes results and standings visible immediately. An organizer can correct them by editing and saving again. Changing a game's or event's scoring recalculates its current results and all applicable standings. No match start, submit, review, publish, or correction reason is required.

## Scoring

Scoring uses fixed decimal arithmetic and takes place per squad and game. Built-in presets are read-only; organizers can clone and configure the scoring mode, kill value, tiers, and fallback. Tiers must be non-negative, bounded, non-overlapping, and cover the configured positions or provide an explicit fallback.

### ArewaVanta Balanced

`total = team kills × kill value + placement points`, with one point per kill by default.

| Placement | Points |
|---|---:|
| 1 | 12 |
| 2 | 9 |
| 3 | 7 |
| 4 | 5 |
| 5 | 4 |
| 6–7 | 3 |
| 8–10 | 2 |
| 11–15 | 1 |
| 16–25 | 0 |

Positions above 25 receive zero placement points by default. Ten kills and second place give **19 points**.

### Warzone-Style Multiplier

`total = team kills × kill value × placement multiplier`, with one point per kill by default.

| Placement | Multiplier |
|---|---:|
| 1 | 2.0× |
| 2–5 | 1.8× |
| 6–10 | 1.6× |
| 11–20 | 1.4× |
| 21–25 | 1.2× |

Ten kills and second place give **18.0 points**; zero kills give zero points. The default tiers cover 25 positions. This is a community adaptation, not a claim about an official Warzone rulebook.

Kills Only awards `kills × kill value`; Placement Only awards the configured placement points.

## Standings and statistics

Squad event and season standings sum saved match points and kills, track games and wins, and do not normalize scores across presets. A mixed-scoring event should clearly show that it uses different rules. Tie-breaks use points, kills, wins, then the sum of placements on games shared by every squad in the tied group. If no such games exist, the remaining tie stays equal.

Player statistics count only actual participants in current saved results. Include total kills, appearances, average kills per appearance, best game, and rankings. A player's UID is private by default. Squad and player identity use stable IDs; names and IGNs are labels.

## Quality requirements

Use transactions, validation, database constraints, secure authentication, scoped authorization, pagination where needed, and tests for scoring and competition behavior. Preserve existing records through forward migrations and retain historical data when events or games are removed. Store timestamps in UTC and use the event timezone for competition dates, defaulting to Africa/Lagos.

The future web interface should be responsive, accessible, and clear on mobile connections. Its design requires the product owner's approval before UI implementation begins.
