import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() =>
  sessionStorage.setItem("arewavanta-organizer-token", "test-token"),
);

const user = {
  id: "u1",
  name: "Organizer",
  email: "organizer@example.test",
  roles: [{ role: "platform_admin", scope_type: "global", scope_id: "*" }],
};
const event = {
  id: "e1",
  title: "Screenshot Cup",
  slug: "screenshot-cup",
  visibility: "public",
  season: null,
  squad_capacity: 25,
  days: [
    {
      id: "d1",
      date: "2026-11-01",
      label: "Sunday",
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
const sheet = {
  event_slots: [
    { squad_id: "s1", slot_number: 12 },
    { squad_id: "s2", slot_number: 6 },
  ],
  event: {
    id: "e1",
    title: "Screenshot Cup",
    slug: "screenshot-cup",
    timezone: "Africa/Lagos",
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
      name: "Kano Reapers",
      squad_number: 1,
      tag: "KR",
      clan: "Kano Clan",
      clan_id: "c1",
      clan_tag: "KC",
      clan_tags: ["KC"],
      clan_squad_count: 1,
      slot_number: 12,
      roster_players: [{ id: "p1", ign: "GrBtness" }],
      eligible_players: [{ id: "p1", ign: "GrBtness" }],
    },
    {
      id: "s2",
      name: "Sokoto Storm",
      squad_number: 1,
      tag: "SS",
      clan: "Sokoto Clan",
      clan_id: "c2",
      clan_tag: "SC",
      clan_tags: ["SC"],
      clan_squad_count: 1,
      slot_number: 6,
      roster_players: [{ id: "p2", ign: "SILKY" }],
      eligible_players: [{ id: "p2", ign: "SILKY" }],
    },
  ],
  result: null,
};
const imported = {
  teams: [
    {
      team_label: "TEAM12",
      team_number: 12,
      placement: 1,
      team_kills: null,
      known_kills: 19,
      status: "matched",
      squad: {
        id: "s1",
        name: "Kano Reapers",
        squad_number: 1,
        clan: "Kano Clan",
        clan_id: "c1",
        clan_tag: "KC",
        clan_squad_count: 1,
        slot_number: 12,
      },
      suggested_squad: null,
      players: [
        {
          name: "GrBtness",
          kills: 13,
          status: "matched",
          player_id: "p1",
          ign: "GrBtness",
          squad_id: "s1",
          squad_name: "Kano Reapers",
          clan: "Kano Clan",
          clan_tag: "KC",
          slot_number: 12,
          candidates: [],
        },
        {
          name: "NEW PLAYER",
          tag: "KC",
          kills: 4,
          status: "new",
          player_id: null,
          ign: "NEW PLAYER",
          clan: "Kano Clan",
          clan_id: "c1",
          clan_tag: "KC",
          clan_tags: ["KC"],
          candidates: [],
        },
        {
          name: "GUEST1",
          kills: 2,
          status: "other_squad",
          player_id: "p3",
          ign: "GUEST1",
          squad_id: "s2",
          squad_name: "Sokoto Storm",
          clan: "Sokoto Clan",
          clan_id: "c2",
          clan_tag: "SC",
          clan_tags: ["SC"],
          slot_number: 6,
          candidates: [],
        },
      ],
    },
    {
      team_label: "TEAM18",
      team_number: 18,
      placement: 2,
      team_kills: null,
      known_kills: 7,
      status: "unassigned",
      squad: null,
      suggested_squad: null,
      players: [
        {
          name: "SILKY",
          kills: 7,
          status: "new",
          player_id: null,
          ign: "SILKY",
          candidates: [],
        },
      ],
    },
  ],
  warnings: [],
  model: "deepseek-flash",
  summary: {
    teams: 2,
    matched_teams: 1,
    unresolved_teams: 1,
    players: 4,
    matched_players: 1,
    guest_candidates: 1,
    new_candidates: 2,
    ambiguous_players: 0,
    duplicate_players: 0,
  },
};

let savedResults = null;

await page.route("**/api/v1/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/v1/auth/me")
    return route.fulfill({ json: { data: user } });
  if (path === "/api/v1/manage/events/e1")
    return route.fulfill({ json: { data: event } });
  if (path === "/api/v1/manage/matches/m1/result-sheet")
    return route.fulfill({ json: { data: sheet } });
  if (path === "/api/v1/manage/clans/c1/players")
    return route.fulfill({ json: { data: [{ id: "p1", current_ign: "GrBtness", squads: [] }] } });
  if (path === "/api/v1/manage/clans/c2/players")
    return route.fulfill({ json: { data: [{ id: "p2", current_ign: "SILKY", squads: [] }] } });
  if (
    path === "/api/v1/manage/matches/m1/screenshot-import" &&
    route.request().method() === "POST"
  )
    return route.fulfill({ json: { data: imported } });
  if (
    path === "/api/v1/manage/matches/m1/results" &&
    route.request().method() === "PUT"
  ) {
    const body = route.request().postDataJSON();
    savedResults = body;
    return route.fulfill({
      json: {
        data: {
          saved_at: new Date().toISOString(),
          lock_version: 2,
          results: body.results.map((row) => ({
            squad_id: row.squad_id,
            squad_name: row.squad_id === "s1" ? "Kano Reapers" : "Sokoto Storm",
            squad_slug: null,
            clan_name: row.squad_id === "s1" ? "Kano Clan" : "Sokoto Clan",
            participation_status: row.status ?? "present",
            placement: row.placement ?? null,
            team_kills: (row.players ?? []).reduce(
              (sum, player) => sum + (player.kills ?? 0),
              0,
            ),
            team_kills_override: row.team_kills ?? null,
            kill_points: "0",
            placement_points: "0",
            placement_multiplier: null,
            total_points: "0",
            players: (row.players ?? []).map((player, index) => ({
              player_id: player.player_id ?? `new-${index}`,
              ign: player.ign ?? "Player",
              kills: player.kills ?? null,
            })),
          })),
        },
      },
    });
  }
  if (path === "/api/v1/manage/matches/m1/players")
    return route.fulfill({
      json: {
        data: [
          { id: "p1", ign: "GrBtness", clan: "Kano Clan" },
          { id: "p2", ign: "SILKY", clan: "Sokoto Clan" },
          { id: "p3", ign: "GUEST1", clan: "Sokoto Clan" },
        ],
        meta: { has_more: false },
      },
    });  return route.fulfill({ status: 404, json: { message: "Not found." } });
});

await page.goto(
  "http://localhost:5173/manage/competitions/e1/results?match=m1",
  { waitUntil: "networkidle" },
);
const screenshotFile = {
  name: "scores.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
    "base64",
  ),
};
await page.getByRole("button", { name: "Import screenshot" }).click();
await page.locator('input[type="file"]').setInputFiles(screenshotFile);
await page.getByRole("button", { name: "Read screenshots" }).click();
await page.getByText(/TEAM12/).waitFor();
assert.equal(
  await page
    .locator(".score-import-player-review")
    .filter({ hasText: "NEW PLAYER" })
    .count(),
  1,
);
await page
  .locator(".score-import-player-review")
  .filter({ hasText: "NEW PLAYER" })
  .getByRole("button", { name: "Create new profile" })
  .click();
await page.getByRole("tab", { name: /Confirmed/ }).click();
await page.getByRole("button", { name: "Use existing guest" }).click();
await page.getByText("Player confirmed", { exact: true }).waitFor();
await page.getByRole("tab", { name: /Teams/ }).click();
assert.equal(
  await page.getByText("Choose this team’s squad", { exact: true }).count(),
  1,
);
await page.getByRole("button", { name: "Add TEAM18 as late entry" }).click();
assert.equal(await page.getByLabel("Game slot").inputValue(), "18");
await page
  .getByRole("button", { name: "Close add slot panel" })
  .click();
await page.getByLabel("Quick map command").fill("TEAM18 is Slot 6");
await page.getByRole("button", { name: "Map team" }).click();
assert.equal(
  await page.getByLabel("Map TEAM18 to an app slot").inputValue(),
  "s2",
);
await page.screenshot({
  path: "artifacts/import-panel-1280.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Apply to draft" }).click();
await page.getByText(/merged into the score draft/).waitFor();
await page.getByRole("button", { name: "Review draft & save" }).click();
await page
  .locator("#score-s1")
  .getByLabel("Placement for Kano Clan")
  .waitFor();
assert.equal(
  await page
    .locator("#score-s1")
    .getByLabel("Placement for Kano Clan")
    .inputValue(),
  "1",
);
assert.equal(
  await page.locator("#score-s1").getByLabel("Kills for KC・GrBtness").inputValue(),
  "13",
);
assert.equal(
  await page
    .locator("#score-s1")
    .getByLabel("Kills for KC・NEW PLAYER")
    .inputValue(),
  "4",
);
assert.equal(
  await page.locator("#score-s1").getByLabel("Kills for KC・GUEST1").inputValue(),
  "2",
);
await page.locator("#score-s2 .score-team-name").click();
await page.locator("#score-s2").getByLabel("Kills for SC・SILKY").waitFor();
assert.equal(
  await page.locator("#score-s2").getByLabel("Kills for SC・SILKY").inputValue(),
  "7",
);
assert.match(
  await page.locator(".score-save-message").innerText(),
  /unsaved changes/,
);

// Applying and saving in one action must send every imported kill to the API.
await page.evaluate(() => localStorage.clear());
await page.goto(
  "http://localhost:5173/manage/competitions/e1/results?match=m1",
  { waitUntil: "networkidle" },
);
await page.getByRole("button", { name: "Import screenshot" }).click();
await page.locator('input[type="file"]').setInputFiles(screenshotFile);
await page.getByRole("button", { name: "Read screenshots" }).click();
await page.getByText(/TEAM12/).waitFor();
await page
  .locator(".score-import-player-review")
  .filter({ hasText: "NEW PLAYER" })
  .getByRole("button", { name: "Create new profile" })
  .click();
await page.getByRole("tab", { name: /Teams/ }).click();
await page
  .getByLabel("Map TEAM18 to an app slot")
  .selectOption({ label: "Slot 6 · SC · Sokoto Clan" });
await page.getByRole("button", { name: "Apply & save to scores" }).click();
await page.getByText(/saved to the score database/).waitFor();
assert.ok(savedResults, "Apply & save must PUT the result rows");
const savedTeam = savedResults.results.find((row) => row.squad_id === "s1");
assert.equal(savedTeam.placement, 1);
assert.equal(savedTeam.players.length, 3);
assert.equal(
  savedTeam.players.find((row) => row.player_id === "p1").kills,
  13,
);
assert.equal(
  savedTeam.players.find((row) => row.player_id === "p3").kills,
  2,
);
const createdPlayer = savedTeam.players.find(
  (row) => row.ign === "NEW PLAYER",
);
assert.equal(createdPlayer.kills, 4);
assert.equal(createdPlayer.player_id, undefined);
assert.equal(createdPlayer.clan_id, "c1");
const savedTeamTwo = savedResults.results.find((row) => row.squad_id === "s2");
const silky = savedTeamTwo.players.find((row) => row.player_id === "p2");
assert.ok(silky, "SILKY must be saved against the existing profile");
assert.equal(silky.kills, 7);

await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => localStorage.clear());
await page.goto(
  "http://localhost:5173/manage/competitions/e1/results?match=m1",
  { waitUntil: "networkidle" },
);
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
await page.getByRole("button", { name: "Import screenshot" }).click();
await page.locator('input[type="file"]').setInputFiles(screenshotFile);
await page.getByRole("button", { name: "Read screenshots" }).click();
await page.getByText(/TEAM12/).waitFor();
await page.getByRole("tab", { name: /Teams/ }).click();
await page
  .getByLabel("Map TEAM18 to an app slot")
  .selectOption({ label: "Slot 6 · SC · Sokoto Clan" });
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  ),
  false,
  "Screenshot import causes horizontal overflow on mobile",
);
await page.screenshot({
  path: "artifacts/import-panel-390.png",
  fullPage: true,
});
assert.deepEqual(errors, []);
console.log("PASS screenshot import, review and draft apply");
await browser.close();
