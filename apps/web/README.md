# ArewaVanta web

The React / TypeScript frontend serves Nigerian Arewa CODM Battle Royale players. The homepage shows public competition dates, maps and recent squad standings from the Laravel API. The rankings page displays event and season squad standings and the global player rankings provided by the API.

## Run locally

Use Node.js 22.12 or newer and start the API as described in the [project README](../../README.md). Then:

```sh
cd apps/web
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `http://127.0.0.1:8000`. For a deployment, serve the API on the same origin under `/api`, or set `VITE_API_BASE_URL` at build time to an accessible API base ending in `/api/v1`. A separate API origin must permit the frontend origin through its CORS configuration. The Vite development proxy is not a production reverse proxy.

The homepage shows loading, empty and error states and does not fall back to fictional results. The current API stores competition dates and maps but does not expose game start times. The player ranking endpoint covers all public competitions; best-game values come from player profiles. Scores and ranks come from the server, including decimal points and tied ranks.

Public competition, game results, clan, squad and player pages use the Laravel API. Squad history is returned in one request and uses the same server standings engine as event rankings. Competition descriptions and types are optional; existing events have no value until an organizer supplies one. The API does not currently expose public clan logo assets. Historical squad and IGN values are shown for each recorded appearance. The organizer competition management screen is available at `/manage/competitions` for signed-in organizers and platform admins. It supports competition creation and edits, schedule and squad changes, and preset selection. Clan, squad, player, and clan captain management is available at `/manage/directory`. Global organizers and platform admins can register and edit players; clan captains can manage their own clans, squads and players. Platform admins can invite clan captains. Match result entry is available at `/manage/competitions/:id/results`; saving or correcting results immediately recalculates the server standings. Sign in with an existing account; the bearer token is retained in session storage for the current browser tab. The older prototype files and fixture data remain in the repository for reference but are not used by the live pages.

## Verify

Start the API and frontend, then run:

```sh
npm run build
npm run check:browser
npm run check:public
npm run check:results
npm run check:manager
npm run check:directory
npm run check:results-real
```

The mock browser checks require Google Chrome or `CHROME_PATH` pointing to a Chromium executable. They check phone and desktop widths, navigation, mock populated API responses, form interactions, and error/retry states. `check:results` also exercises the organizer results form with a large mock match sheet. The API-backed browser checks require the local Laravel API and PostgreSQL services to be running. `check:browser`, `check:public`, `check:manager`, and `check:directory` use isolated fixture responses or read-only API checks. `check:results-real` creates uniquely named temporary organizer, clan, squad, player, season, event, and result records in the development database, exercises scoring and result correction through the real API and UI, and deletes those records afterward. Run it only against the disposable local development database, never production. Screenshots are written to the ignored `artifacts/` directory.

For production configuration, deployment commands, backups, and the `/up` health check, see [the project deployment notes](../../README.md#production-deployment-notes). Account recovery is available at `/forgot-password` and `/reset-password`.

## Presentation conventions

- User-facing screens show names, never database IDs or slugs. Slugs and ULIDs stay in routes and API payloads.
- Shared labels and formatting live in `src/presentation.ts`: competition types, date ranges, placement ordinals, plural counts, time zones, score labels and activity messages.
- Visible wording uses “competition”, “squad”, “player”, “game” and “results” consistently. Scoring-engine internals are not shown to users.
- Tables keep full data on desktop. On phones, secondary columns move into the selected row’s detail so the remaining statistics stay easy to scan.
- Activity entries remain complete audit records on the server; only their displayed copy and timestamps are simplified.

## Assets

Fonts and artwork are local. The original artwork sources and prompts are recorded in [ARTWORK.md](ARTWORK.md). Manrope and Barlow Condensed are licensed under the SIL Open Font License, with copies in `public/fonts/`.
