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

Public competition, game results, clan, squad and player pages use the existing API. Squad history reads scored public event standings in batches; response time grows with the number of events. Competition descriptions and types are optional; existing events have no value until an organizer supplies one. The API does not currently expose public clan logo assets. Historical squad and IGN values are shown for each recorded appearance. The organizer competition management sample is available at `/manage/competitions` for signed-in organizers and platform admins. It supports competition creation and edits, schedule and squad changes, and preset selection. Sign in with an existing organizer account; session credentials are retained for the current browser tab. Clan, squad, player, roster and clan captain management is available at `/manage/directory`. Global organizers and platform admins can register and edit players; clan captains can manage their own clans, squads and rosters. Platform admins can assign clan captains. Result entry and other organizer pages remain future work. The older prototype files and fixture data remain in the repository for reference but are not used by the live pages.

## Verify

Start the API and frontend, then run:

```sh
npm run build
npm run check:browser
npm run check:public
npm run check:manager
npm run check:directory
```

The browser check requires Google Chrome or `CHROME_PATH` pointing to a Chromium executable. It checks phone and desktop widths, accessibility and navigation, mocked populated API responses, errors and retries, and a read-only connection to the running Laravel API. Screenshots are written to the ignored `artifacts/` directory. The tests do not create competitions or modify the development database.

## Assets

Fonts and artwork are local. The original artwork sources and prompts are recorded in [ARTWORK.md](ARTWORK.md). Manrope and Barlow Condensed are licensed under the SIL Open Font License, with copies in `public/fonts/`.
