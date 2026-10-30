import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
});
const base = process.env.PREVIEW_URL ?? "http://localhost:5173";
const squad = {
  id: "s1",
  name: "Kano Squad",
  slug: "kano-squad",
  tag: "KS",
  clan: { name: "Kano Clan", tag: "KC" },
};
const event = {
  id: "e1",
  title: "Weekend Scrim",
  competition_type: "scrim",
  squad_count: 1,
  slug: "weekend",
  timezone: "Africa/Lagos",
  season: null,
  start_date: "2025-10-25",
  end_date: "2025-10-26",
  match_count: 2,
  scored_match_count: 1,
};
const match = {
  id: "m1",
  match_index: 1,
  map_code: "isolated",
  map_label: "Isolated",
  has_results: true,
  is_scoring_override: false,
  scoring: {},
  results: [],
};
const detail = {
  ...event,
  description: "Weekend games for the community.",
  maximum_position: 25,
  squad_size: 4,
  default_scoring: { preset_name: "ArewaVanta Balanced", mode: "additive" },
  squads: [squad],
  days: [
    {
      id: "d1",
      date: "2025-10-25",
      label: "Saturday",
      sort_order: 1,
      matches: [match],
    },
    {
      id: "d2",
      date: "2025-10-26",
      label: "Sunday",
      sort_order: 2,
      matches: [
        { ...match, id: "m2", map_label: "Blackout", has_results: false },
      ],
    },
  ],
};
const standing = {
  rank: 1,
  squad,
  matches_played: 1,
  total_kills: 10,
  wins: 0,
  total_points: "19.00",
  additive_placement_points: "9",
  multiplier_scored_points: "0",
  multiplier_matches: 0,
  tie_break_position_sum: null,
  match_results: [],
};
const standings = {
  event: { id: "e1", title: event.title, slug: event.slug },
  uses_mixed_scoring_presets: false,
  standings: [standing],
};
const result = {
  match: {
    id: "m1",
    event: { id: "e1", title: event.title, slug: event.slug },
    date: "2025-10-25",
    match_index: 1,
    map_code: "isolated",
    map_label: "Isolated",
  },
  scoring: {},
  result: {
    saved_at: null,
    results: [
      {
        squad_id: "s1",
        squad_name: squad.name,
        squad_slug: squad.slug,
        clan_name: "Kano Clan",
        participation_status: "present",
        placement: 2,
        team_kills: 10,
        kill_points: "10.00",
        placement_points: "9.00",
        placement_multiplier: null,
        total_points: "19.00",
        players: [{ player_id: "p1", ign: "ACE", kills: 10 }],
      },
    ],
  },
};
const clan = {
  id: "c1",
  name: "Kano Clan",
  slug: "kano",
  tag: "KC",
  bio: "A community clan",
  squads: [{ id: "s1", name: squad.name, slug: squad.slug, tag: "KS" }],
};
const profile = {
  id: "p1",
  current_ign: "ACE",
  current_squads: [
    {
      id: "s1",
      name: "Kano Squad",
      slug: "kano-squad",
      clan: { name: "Kano Clan", slug: "kano" },
    },
  ],
  uid: null,
  appearances: 1,
  total_kills: 10,
  kills_per_appearance: "10.00",
  best_game_kills: 10,
  match_history: [
    {
      ign_snapshot: "OLD ACE",
      kills: 10,
      match_id: "m1",
      match_index: 1,
      map_label: "Isolated",
      event_date: "2025-10-25",
      event_title: event.title,
      event_slug: event.slug,
      squad_id: "s1",
      squad_name_snapshot: squad.name,
    },
  ],
  history_meta: { current_page: 1, last_page: 1, total: 1 },
};
const meta = { current_page: 1, last_page: 1, total: 1 };
for (const width of [360, 390, 430, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const map = {
      "/api/v1/events": { data: [event], meta },
      "/api/v1/events/weekend": { data: detail },
      "/api/v1/events/weekend/standings": { data: standings },
      "/api/v1/matches/m1/results": { data: result },
      "/api/v1/clans": { data: [clan], meta },
      "/api/v1/clans/kano": { data: clan },
      "/api/v1/squads/kano-squad": {
        data: {
          ...squad,
          clan: { id: "c1", name: clan.name, slug: clan.slug, tag: clan.tag },
          roster: [{ id: "p1", ign: "ACE" }],
        },
      },
      "/api/v1/players": { data: [{ id: "p1", current_ign: "ACE" }], meta },
      "/api/v1/players/p1": { data: profile },
    };
    return map[path]
      ? route.fulfill({ json: map[path] })
      : route.fulfill({ status: 404, json: { message: "Not found" } });
  });
  async function open(path, text) {
    await page.goto(base + path);
    await page.getByText(text, { exact: false }).first().waitFor();
    await page.waitForTimeout(100);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, `${path} overflow at ${width}`);
  }
  await open("/competitions", "Weekend Scrim");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByRole("link", { name: /Weekend Scrim/ }).click();
  await page.getByText("Game schedule").waitFor();
  await page.getByText("Weekend games for the community.").waitFor();
  await page.getByRole("button", { name: "Sunday" }).click();
  await page.getByText("Blackout").waitFor();
  await page.getByRole("button", { name: "Standings", exact: true }).click();
  await page.getByText("19.00").waitFor();
  await page.getByRole("button", { name: "Squads (1)" }).click();
  await page.getByRole("link", { name: /Kano Squad/ }).waitFor();
  await open("/competitions/weekend/games/m1", "Match results");
  await page.getByText("19.00").waitFor();
  await page.getByRole("link", { name: "ACE", exact: true }).waitFor();
  await page.getByText("9.00", { exact: true }).waitFor();
  if (width === 390)
    await page.screenshot({
      path: "artifacts/public-match-390.png",
      fullPage: true,
    });
  await open("/competitions/weekend/games/m2", "Results have not been saved");
  await open("/clans", "Kano Clan");
  await page.getByRole("link", { name: /Kano Clan/ }).click();
  await page.getByRole("link", { name: /Kano Squad/ }).click();
  await page.getByText("Competition history").waitFor();
  await page.getByText("Rank 1").waitFor();
  await page.getByRole("link", { name: /ACE/ }).click();
  await page.getByText("Played as OLD ACE").waitFor();
  await page.getByRole("link", { name: "Kano Clan", exact: true }).waitFor();
  await open("/players", "ACE");
  await page.getByRole("link", { name: /ACE/ }).click();
  await page.getByText("10.00").waitFor();
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${width}px public pages, navigation, result breakdown and profiles`,
  );
  await page.close();
}
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
await page.route("**/api/v1/**", (route) =>
  route.fulfill({ status: 503, json: { message: "Temporarily unavailable" } }),
);
await page.goto(base + "/clans");
await page.getByText("Temporarily unavailable").waitFor();
await page.getByRole("button", { name: /Try again/ }).waitFor();
await page.unrouteAll();
await page.route("**/api/v1/**", (route) =>
  route.fulfill({
    json: { data: [], meta: { current_page: 1, last_page: 1, total: 0 } },
  }),
);
await page.goto(base + "/competitions");
await page.getByText("No competitions to show here yet.").waitFor();
await page.goto(base + "/players");
await page.getByText("No players found.").waitFor();
console.log("PASS empty and error states");
await page.close();
await browser.close();
