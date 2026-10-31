import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const base = process.env.PREVIEW_URL ?? "http://localhost:5173";
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
});
const meta = { current_page: 1, last_page: 1, total: 1 };
const user = {
  id: "u",
  name: "Organiser",
  email: "organiser@example.test",
  roles: [{ role: "organizer", scope_type: "global", scope_id: "*" }],
};
const preset = {
  id: "preset",
  name: "ArewaVanta Balanced",
  slug: "aga-balanced",
  description: "Balanced scoring.",
  is_builtin: true,
  versions: [
    {
      id: "score1",
      version_number: 1,
      mode: "additive",
      kill_point_value: "1",
      maximum_position: 25,
    },
  ],
};
const warzone = {
  ...preset,
  id: "preset2",
  name: "Warzone-Style Multiplier",
  slug: "warzone-style-multiplier",
  versions: [{ ...preset.versions[0], id: "score2", mode: "multiplier" }],
};
const clan = {
  id: "c1",
  name: "Kano Clan",
  slug: "kano",
  tag: "KC",
  bio: null,
  squads: [{ id: "s1", name: "Kano Squad", slug: "kano-squad", tag: "KS" }],
};
const generateDays = () =>
  ["Saturday", "Sunday"].map((label, di) => ({
    id: `day-${di}`,
    label,
    date: `2099-10-${di === 0 ? "03" : "04"}`,
    sort_order: di + 1,
    matches: ["Isolated", "Isolated", "Blackout"].map((map_label, gi) => ({
      id: `game-${di}-${gi}`,
      match_index: gi + 1,
      map_code: map_label.toLowerCase(),
      map_label,
      has_results: false,
      is_scoring_override: false,
      scoring: {},
      expected_squads: [],
    })),
  }));
for (const width of [360, 390, 430, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let event = null;
  let creates = 0;
  let failure = false;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    const data = request.postDataJSON();
    if (path === "/api/v1/auth/login")
      return route.fulfill({ json: { data: { token: "test-token", user } } });
    if (path === "/api/v1/auth/me")
      return route.fulfill({ json: { data: user } });
    if (path === "/api/v1/auth/logout") return route.fulfill({ status: 204 });
    if (path === "/api/v1/clans")
      return route.fulfill({ json: { data: [clan], meta } });
    if (path === "/api/v1/manage/scoring-presets")
      return route.fulfill({ json: { data: [preset, warzone] } });
    if (path === "/api/v1/manage/competition-templates")
      return route.fulfill({ json: { data: [] } });
    if (path === "/api/v1/manage/events" && method === "GET")
      return route.fulfill({
        json: {
          data: event
            ? [
                {
                  id: event.id,
                  title: event.title,
                  slug: event.slug,
                  visibility: "public",
                  season: null,
                  start_date: event.days[0].date,
                  match_count: event.days.reduce(
                    (n, d) => n + d.matches.length,
                    0,
                  ),
                  scored_match_count: 0,
                  squad_count: event.squads?.length ?? 0,
                  squad_capacity: event.squad_capacity ?? 20,
                  pending_submission_count: 0,
                },
              ]
            : [],
          meta,
        },
      });
    if (path === "/api/v1/manage/events" && method === "POST") {
      creates++;
      assert.equal(data.title, "Weekend test");
      assert.equal(data.squad_capacity, 20);
      assert.equal(data.scoring_rule_version_id, "score1");
      event = {
        id: "e1",
        title: data.title,
        description: data.description,
        competition_type: data.competition_type,
        slug: "weekend",
        visibility: "public",
        timezone: "Africa/Lagos",
        squad_size: 4,
        squad_capacity: data.squad_capacity ?? 20,
        maximum_position: 25,
        season: null,
        scoring: {
          preset_name: preset.name,
          version_number: 1,
          mode: "additive",
          rules: {},
        },
        squads: [],
        days: generateDays(),
      };
      return route.fulfill({ status: 201, json: { data: event } });
    }
    if (path === "/api/v1/manage/events/e1" && method === "GET")
      return route.fulfill({ json: { data: event } });
    if (path === "/api/v1/manage/events/e1" && method === "PATCH") {
      event = { ...event, ...data };
      if (data.scoring_rule_version_id === "score2")
        event.scoring = {
          ...event.scoring,
          preset_name: warzone.name,
          mode: "multiplier",
        };
      return route.fulfill({ json: { data: event } });
    }
    if (path === "/api/v1/manage/events/e1/schedule") {
      if (failure) {
        failure = false;
        return route.fulfill({
          status: 422,
          json: {
            message: "Schedule could not be saved.",
            errors: { days: ["Schedule error."] },
          },
        });
      }
      event.days = data.days.map((day, di) => ({
        id: day.id ?? `new-day-${di}`,
        date: day.date,
        label: day.label,
        sort_order: di + 1,
        matches: day.games.map((game, gi) => ({
          id: game.id ?? `new-game-${di}-${gi}`,
          match_index: gi + 1,
          map_code: game.map_code,
          map_label: game.map_label,
          has_results: false,
          is_scoring_override: false,
          scoring: {},
          expected_squads: [],
        })),
      }));
      return route.fulfill({ json: { data: event } });
    }
    if (path === "/api/v1/manage/events/e1/squads") {
      event.squads = data.squad_ids.map((id) => ({
        id,
        name: "Kano Squad",
        tag: "KS",
        clan: "Kano Clan",
        seed: null,
      }));
      return route.fulfill({ json: { data: event } });
    }
    return route.fulfill({
      status: 404,
      json: { message: `Unknown route ${path}` },
    });
  });
  await page.goto(base + "/manage/competitions");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("not-a-real-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("No competitions yet.").waitFor();
  await page.getByRole("button", { name: "Create competition" }).click();
  await page.getByLabel("Competition name").waitFor();
  assert.equal(await page.locator(".manage-day").count(), 2);
  assert.equal(await page.locator(".manage-game").count(), 6);
  const maps = await page
    .locator(".manage-game input")
    .evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(maps, [
    "Isolated",
    "Isolated",
    "Blackout",
    "Isolated",
    "Isolated",
    "Blackout",
  ]);
  assert.equal(await page.getByLabel("Maximum participating squads").inputValue(), "20");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false, `${width}px overflow`);
  if (width === 390 || width === 1440)
    await page.screenshot({
      path: `artifacts/manage-form-${width}.png`,
      fullPage: true,
    });
  await page.getByLabel("Competition name").fill("Weekend test");
  await page.getByLabel("Competition type").selectOption("scrim");
  await page.locator(".manage-day input[type=date]").nth(0).fill("2099-10-03");
  await page.locator(".manage-day input[type=date]").nth(1).fill("2099-10-04");
  failure = true;
  await page.getByRole("button", { name: "Save competition" }).click();
  await page
    .getByText("Schedule could not be saved.", { exact: false })
    .first()
    .waitFor();
  assert.equal(creates, 1);
  await page.getByRole("button", { name: "Save competition" }).click();
  await page.getByText("Competition saved.").waitFor();
  assert.equal(creates, 1);
  await page.getByRole("button", { name: "Edit competition" }).click();
  await page.getByLabel("Competition name").fill("Weekend updated");
  await page.getByLabel("Competition type").selectOption("league");
  await page.getByLabel("Scoring preset").selectOption("score2");
  await page.locator(".manage-game input").nth(0).fill("Blackout");
  await page.getByLabel("Maximum participating squads").fill("24");
  await page.getByRole("button", { name: "Save competition" }).click();
  await page.getByText("Weekend updated").waitFor();
  assert.equal(event.days[0].matches[0].map_label, "Blackout");
  assert.equal(event.days[0].matches[0].id, "game-0-0");
  assert.equal(event.squad_capacity, 24);
  assert.equal(event.competition_type, "league");
  assert.equal(event.scoring.preset_name, warzone.name);
  assert.deepEqual(errors, []);
  if (width === 390 || width === 1440)
    await page.screenshot({
      path: `artifacts/manage-list-${width}.png`,
      fullPage: true,
    });
  console.log(`PASS ${width}px auth, defaults, create, partial retry and edit`);
  await page.close();
}
await browser.close();
