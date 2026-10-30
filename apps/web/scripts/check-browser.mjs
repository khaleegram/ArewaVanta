import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.PREVIEW_URL ?? "http://localhost:5173";
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
});
await mkdir("artifacts", { recursive: true });
const season = { id: "season-1", name: "Arewa League" };
const upcoming = {
  id: "event-future",
  title: "Northern Scrim",
  slug: "northern-scrim",
  timezone: "Africa/Lagos",
  season,
  start_date: "2099-11-01",
  end_date: "2099-11-02",
  match_count: 3,
  scored_match_count: 0,
};
const previous = {
  id: "event-past",
  title: "Arewa Weekend",
  slug: "arewa-weekend",
  timezone: "Africa/Lagos",
  season,
  start_date: "2025-10-25",
  end_date: "2025-10-26",
  match_count: 3,
  scored_match_count: 2,
};
const squad = (id, name, kills, points, rank) => ({
  rank,
  squad: {
    id,
    name,
    slug: id,
    tag: id,
    clan: { name: "Arewa Clan", tag: "AC" },
  },
  matches_played: 2,
  total_kills: kills,
  wins: 1,
  total_points: points,
  additive_placement_points: "0",
  multiplier_scored_points: points,
  multiplier_matches: 2,
  tie_break_position_sum: null,
  match_results: [
    {
      match_id: "match-saved",
      event_date: "2025-10-25",
      match_index: 1,
      map_label: "Isolated",
      scoring_preset: "Warzone-Style Multiplier",
      placement: 2,
      team_kills: kills,
      total_points: points,
    },
  ],
});
const standings = {
  uses_mixed_scoring_presets: true,
  standings: [
    squad("KNO", "Kano Reapers", 12, "21.5", 1),
    squad("ZAR", "Zaria Wolves", 12, "21.5", 1),
  ],
};
const eventDetails = {
  ...upcoming,
  maximum_position: 25,
  squad_size: 4,
  default_scoring: { preset_name: "ArewaVanta Balanced", mode: "additive" },
  squads: [],
  days: [
    {
      id: "d1",
      date: "2099-11-01",
      label: "Saturday",
      sort_order: 1,
      matches: [
        {
          id: "m1",
          match_index: 1,
          map_code: "isolated",
          map_label: "Isolated",
          has_results: false,
          is_scoring_override: false,
          scoring: {},
          results: null,
        },
        {
          id: "m2",
          match_index: 2,
          map_code: "blackout",
          map_label: "Blackout",
          has_results: true,
          is_scoring_override: true,
          scoring: {},
          results: [],
        },
      ],
    },
    {
      id: "d2",
      date: "2099-11-02",
      label: "Sunday",
      sort_order: 2,
      matches: [
        {
          id: "m3",
          match_index: 3,
          map_code: "isolated",
          map_label: "Isolated",
          has_results: false,
          is_scoring_override: false,
          scoring: {},
          results: null,
        },
      ],
    },
  ],
};
const profile = {
  id: "p1",
  current_ign: "REAPER",
  uid: null,
  appearances: 3,
  total_kills: 10,
  kills_per_appearance: "3.33",
  best_game_kills: 5,
  match_history: [
    {
      ign_snapshot: "REAPER",
      kills: 5,
      match_id: "match-saved",
      match_index: 1,
      map_label: "Isolated",
      event_date: "2025-10-25",
      event_title: "Arewa Weekend",
      event_slug: "arewa-weekend",
      squad_id: "KNO",
      squad_name_snapshot: "Kano Reapers",
    },
  ],
  history_meta: { current_page: 1, last_page: 1, total: 1 },
};
let failure = "";
async function mockApi(route) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  if (
    failure &&
    ((failure === "events" && path.endsWith("/events")) ||
      (failure === "details" && path.endsWith("/events/northern-scrim")) ||
      (failure === "standings" &&
        path.endsWith("/events/arewa-weekend/standings")))
  )
    return route.fulfill({
      status: 503,
      json: { message: "Service temporarily unavailable." },
    });
  if (path === "/api/v1/events")
    return route.fulfill({
      json:
        url.searchParams.get("page") === "2"
          ? {
              data: [previous],
              meta: { current_page: 2, last_page: 2, total: 2 },
            }
          : {
              data: [upcoming],
              meta: { current_page: 1, last_page: 2, total: 2 },
            },
    });
  if (path === "/api/v1/events/northern-scrim")
    return route.fulfill({ json: { data: eventDetails } });
  if (
    path === "/api/v1/events/arewa-weekend/standings" ||
    path === "/api/v1/events/northern-scrim/standings"
  )
    return route.fulfill({
      json: {
        data: {
          event: {
            id: previous.id,
            title: previous.title,
            slug: previous.slug,
          },
          ...standings,
        },
      },
    });
  if (path === "/api/v1/seasons/season-1/standings")
    return route.fulfill({
      json: {
        data: {
          season: { id: season.id, name: season.name, slug: "arewa-league" },
          ...standings,
        },
      },
    });
  if (path === "/api/v1/rankings/players")
    return route.fulfill({
      json: {
        data: [
          { id: "p1", ign: "REAPER", appearances: 3, total_kills: 10, rank: 1 },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      },
    });
  if (path === "/api/v1/players/p1")
    return route.fulfill({ json: { data: profile } });
  return route.fulfill({ status: 404, json: { message: "Not found." } });
}
async function inspectLayout(page, width) {
  const info = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    hero: document.querySelector(".home-hero").getBoundingClientRect().height,
    schedule:
      document.querySelector("#schedule").getBoundingClientRect().top + scrollY,
    standings:
      document.querySelector("#standings").getBoundingClientRect().top +
      scrollY,
    clipped: [
      ...document.querySelectorAll(
        ".home-hero h1,.home-event-main h3,.home-squad-name,.home-games strong",
      ),
    ]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent),
  }));
  assert.ok(
    info.width <= width + 1,
    `Horizontal overflow at ${width}: ${JSON.stringify(info)}`,
  );
  assert.deepEqual(
    info.clipped,
    [],
    `Clipped text at ${width}: ${JSON.stringify(info)}`,
  );
  if (width >= 360 && width <= 430) {
    assert.ok(info.hero < 380, `Hero too tall: ${JSON.stringify(info)}`);
    assert.ok(
      info.schedule < 800,
      `Schedule too far down: ${JSON.stringify(info)}`,
    );
    assert.ok(
      info.standings < 1500,
      `Standings too far down: ${JSON.stringify(info)}`,
    );
  }
}
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/v1/**", mockApi);
  for (const width of [1440, 1024, 768, 430, 390, 360, 320]) {
    await page.setViewportSize({ width, height: width > 760 ? 1000 : 844 });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    assert.match(
      await page.locator("#competition").innerText(),
      /Northern Scrim/,
    );
    assert.match(await page.locator("#schedule").innerText(), /Isolated/);
    assert.match(await page.locator("#standings").innerText(), /Arewa Weekend/);
    assert.match(await page.locator("#standings").innerText(), /21\.5/);
    assert.match(
      await page.locator("#standings").innerText(),
      /Mixed scoring rules/,
    );
    assert.equal(await page.locator("#standings tbody tr").count(), 2);
    assert.equal(await page.locator(".competition-dialog").count(), 0);
    assert.equal(await page.getByText("19:00").count(), 0);
    await inspectLayout(page, width);
    await page.getByRole("button", { name: /Sunday/ }).click();
    assert.equal(await page.locator(".home-games li").count(), 1);
    if ([1440, 390, 360].includes(width)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `artifacts/live-home-${width}.png`,
        fullPage: true,
      });
    }
    console.log(
      `PASS ${width}px: live competition, schedule, standings, mixed scoring and responsive layout`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open navigation" }).click();
  assert.equal(await page.locator("#main-navigation").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "Open navigation" })
      .getAttribute("aria-expanded"),
    "false",
  );
  await page
    .locator("#standings")
    .getByRole("link", { name: /Full rankings/ })
    .click();
  assert.match(page.url(), /event=arewa-weekend/);
  await page.getByRole("heading", { name: /Squad standings/ }).waitFor();
  assert.equal(
    await page
      .locator(".lb-result-row")
      .first()
      .locator(".lb-score")
      .innerText(),
    "21.5",
  );
  assert.equal(
    await page.locator(".lb-result-row").nth(1).locator(".lb-rank").innerText(),
    "1",
  );
  await page
    .getByRole("combobox", { name: "Event or season" })
    .selectOption("season:season-1");
  await page
    .locator(".lb-results .lb-overline")
    .filter({ hasText: "Arewa League" })
    .waitFor();
  assert.match(page.url(), /season=season-1/);
  await page.getByRole("tab", { name: /Players/ }).click();
  await page.getByRole("heading", { name: /Player rankings/ }).waitFor();
  assert.match(
    await page.locator(".lb-live-context").innerText(),
    /all public competitions/,
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector(".lb-result-row td:nth-child(5)")
        ?.textContent?.trim() === "5",
  );
  assert.equal(
    await page.locator(".lb-result-row td:nth-child(4)").innerText(),
    "3.33",
  );
  await page.getByRole("button", { name: /REAPER/ }).click();
  await page.getByText("Best game", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS rankings API, tie ranks, exact decimals, season, player profile and navigation",
  );
  failure = "events";
  await page.goto(base, { waitUntil: "networkidle" });
  assert.match(
    await page.locator("#competition").innerText(),
    /Service temporarily unavailable/,
  );
  failure = "";
  await page
    .locator("#competition")
    .getByRole("button", { name: /Try again/ })
    .click();
  await page.getByRole("heading", { name: "Northern Scrim" }).waitFor();
  failure = "details";
  await page.goto(base, { waitUntil: "networkidle" });
  assert.match(
    await page.locator("#schedule").innerText(),
    /Service temporarily unavailable/,
  );
  failure = "";
  await page
    .locator("#schedule")
    .getByRole("button", { name: /Try again/ })
    .click();
  await page.locator(".home-games").waitFor();
  failure = "standings";
  await page.goto(base, { waitUntil: "networkidle" });
  assert.match(
    await page.locator("#standings").innerText(),
    /Service temporarily unavailable/,
  );
  failure = "";
  await page
    .locator("#standings")
    .getByRole("button", { name: /Try again/ })
    .click();
  await page.locator(".home-table tbody tr").first().waitFor();
  console.log(
    "PASS loading errors and retry for events, schedule and standings",
  );
  await page.unroute("**/api/v1/**", mockApi);
  const eventResponse = await page.request.get(
    `${base}/api/v1/events?per_page=50`,
  );
  const playerResponse = await page.request.get(
    `${base}/api/v1/rankings/players`,
  );
  assert.ok(eventResponse.ok(), "Laravel event API is unavailable");
  assert.ok(playerResponse.ok(), "Laravel player API is unavailable");
  const realEvents = await eventResponse.json(),
    realPlayers = await playerResponse.json();
  await page.goto(base, { waitUntil: "networkidle" });
  if (realEvents.meta.total === 0) {
    assert.match(
      await page.locator("#competition").innerText(),
      /No upcoming competitions/,
    );
    assert.match(
      await page.locator("#standings").innerText(),
      /No results yet/,
    );
  }
  await page.goto(`${base}/leaderboard`, { waitUntil: "networkidle" });
  if (realEvents.meta.total === 0)
    assert.match(
      await page.locator("#full-ranking-panel").innerText(),
      /No competitions yet/,
    );
  await page.getByRole("tab", { name: /Players/ }).click();
  if (realPlayers.meta.total === 0) {
    await page
      .getByText(
        "No player rankings yet. They will appear after results are saved.",
      )
      .waitFor();
    assert.match(
      await page.locator("#full-ranking-panel").innerText(),
      /No player rankings yet/,
    );
  }
  console.log(
    `PASS actual Laravel API (events: ${realEvents.meta.total}, ranked players: ${realPlayers.meta.total})`,
  );
  await page.close();
} finally {
  await browser.close();
}
