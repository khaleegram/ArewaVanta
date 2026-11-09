import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
});
const base = process.env.PREVIEW_URL ?? "http://localhost:5173";
const user = { id: "u", name: "Organizer", roles: [] };
const scoring = {
  version_id: "v1",
  mode: "additive",
  kill_point_value: "1",
  maximum_position: 25,
  tiers: [
    {
      position_from: 1,
      position_to: 25,
      placement_points: "0",
      multiplier: null,
    },
  ],
  fallback_placement_points: null,
  fallback_multiplier: null,
};
const event = {
  id: "e1",
  title: "Weekend Scrims",
  slug: "weekend",
  timezone: "Africa/Lagos",
  visibility: "public",
  season: null,
  squad_capacity: 25,
  squad_size: 4,
  maximum_position: 25,
  days: [
    {
      id: "d1",
      label: "Sunday",
      date: "2026-11-01",
      sort_order: 1,
      matches: [
        {
          id: "m1",
          match_index: 1,
          map_code: "isolated",
          map_label: "Isolated",
          has_results: false,
        },
      ],
    },
  ],
};
const sheet = {
  event_slots: [
    { squad_id: "s1", slot_number: 6 },
    { squad_id: "s2", slot_number: 12 },
  ],
  event: {
    id: "e1",
    title: event.title,
    slug: event.slug,
    timezone: event.timezone,
    squad_size: 4,
    maximum_position: 25,
    track_player_kills: true,
  },
  match: {
    id: "m1",
    date: "2026-11-01",
    match_index: 1,
    map_label: "Isolated",
    scoring,
  },
  squads: [
    {
      id: "s1",
      name: "Squad 1",
      squad_number: 1,
      tag: null,
      clan: "Kano Clan",
      clan_id: "c1",
      clan_tag: "KC",
      clan_squad_count: 1,
      slot_number: 6,
      roster_players: [],
      eligible_players: [{ id: "p1", ign: "ACE" }],
    },
    {
      id: "s2",
      name: "Squad 1",
      squad_number: 1,
      tag: null,
      clan: "Sokoto Clan",
      clan_id: "c2",
      clan_tag: "SC",
      clan_squad_count: 1,
      slot_number: 12,
      roster_players: [],
      eligible_players: [{ id: "p2", ign: "BEN" }],
    },
  ],
  result: null,
};
for (const width of [360, 390, 430, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    sessionStorage.setItem("arewavanta-organizer-token", "token"),
  );
  let saved = null;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/me"))
      return route.fulfill({ json: { data: user } });
    if (path.endsWith("/manage/events/e1"))
      return route.fulfill({ json: { data: event } });
    if (path.endsWith("/manage/clans/c1/players"))
      return route.fulfill({
        json: { data: [{ id: "p1", current_ign: "ACE", squads: [] }] },
      });
    if (path.endsWith("/manage/clans/c2/players"))
      return route.fulfill({
        json: { data: [{ id: "p2", current_ign: "BEN", squads: [] }] },
      });
    if (path.endsWith("/result-sheet"))
      return route.fulfill({
        json: { data: { ...sheet, result: saved } },
      });
    if (path.endsWith("/matches/m1/results") && request.method() === "PUT") {
      const body = request.postDataJSON();
      assert.equal(body.patch_mode, true);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].squad_id, "s1");
      assert.equal(body.results[0].placement, 1);
      assert.deepEqual(body.results[0].players, [
        { player_id: "p1", kills: 7 },
      ]);
      saved = {
        saved_at: "2026-11-01T20:00:00+01:00",
        lock_version: 1,
        results: body.results.map((result) => ({
          squad_id: result.squad_id,
          source_team_number: null,
          squad_name: "Squad 1",
          squad_number: 1,
          squad_slug: "squad-1",
          clan_name: "Kano Clan",
          clan_tag: "KC",
          clan_squad_count: 1,
          participation_status: "present",
          placement: result.placement,
          team_kills: 7,
          team_kills_override: null,
          kills_confirmed: true,
          is_partial: false,
          unattributed_kills: 0,
          kill_points: "7",
          placement_points: "0",
          placement_multiplier: null,
          total_points: "7",
          players: result.players.map((player) => ({
            ...player,
            ign: "ACE",
          })),
        })),
      };
      return route.fulfill({ json: { data: saved } });
    }
    return route.fulfill({ status: 404, json: { message: "Not found" } });
  });
  await page.goto(`${base}/manage/competitions/e1/results?match=m1`);
  await page.getByRole("heading", { name: "Enter results." }).waitFor();
  await page.locator("#score-s1 .score-team-name").click();
  await page
    .locator("#score-s1 .score-pool-list")
    .getByRole("button", { name: /ACE/ })
    .click();
  await page.locator("#score-s1").getByLabel("Kills for KC・ACE").fill("7");
  await page
    .locator("#score-s1")
    .getByLabel("Placement for Kano Clan")
    .fill("1");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `overflow at ${width}`,
  );
  await page.getByRole("button", { name: "Save all changes" }).click();
  await page.getByText(/Team saved. Standings updated/).waitFor();
  assert.equal(
    await page.locator("#score-s1").getByLabel("Kills for KC・ACE").inputValue(),
    "7",
  );
  assert.deepEqual(errors, []);
  await page.locator("#score-s1").getByLabel("Kills for KC・ACE").fill("9");
  assert.match(
    await page.locator(".score-save-message").innerText(),
    /unsaved changes/,
  );
  if (width === 390 || width === 1440)
    await page.screenshot({
      path: `artifacts/results-${width}.png`,
      fullPage: true,
    });
  console.log(`${width}px: clan slot entry, validation and save passed`);
  await page.close();
}
await browser.close();
