import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
});
const base = process.env.PREVIEW_URL ?? "http://localhost:5173";
for (const width of [360, 390, 430, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const user = {
    id: "u1",
    name: "Organizer",
    email: "organizer@example.test",
    roles: [{ role: "platform_admin", scope_type: "global", scope_id: "*" }],
  };
  const meta = { current_page: 1, last_page: 1, total: 1 };
  let clans = [];
  let players = [];
  let roster = [];
  let counter = 0;
  const person = {
    id: 2,
    name: "Captain",
    email: "captain@example.test",
    roles: [],
  };
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      method = req.method(),
      body = req.postDataJSON();
    if (path === "/api/v1/auth/login")
      return route.fulfill({ json: { data: { token: "test", user } } });
    if (path === "/api/v1/auth/me")
      return route.fulfill({ json: { data: user } });
    if (path === "/api/v1/manage/people")
      return route.fulfill({ json: { data: [person], meta } });
    if (path === "/api/v1/manage/people/2/roles" && method === "POST") {
      person.roles = [{ id: "role1", ...body }];
      return route.fulfill({ status: 201, json: { data: { id: "role1" } } });
    }
    if (path === "/api/v1/manage/people/2/roles/role1" && method === "DELETE") {
      person.roles = [];
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/v1/manage/clans" && method === "GET")
      return route.fulfill({ json: { data: clans, meta } });
    if (path === "/api/v1/manage/clans" && method === "POST") {
      clans.push({ id: "c1", slug: "kano", squads: [], ...body });
      return route.fulfill({ status: 201, json: { data: clans[0] } });
    }
    if (path === "/api/v1/clans/kano")
      return route.fulfill({ json: { data: clans[0] } });
    if (path === "/api/v1/manage/clans/c1" && method === "PATCH") {
      Object.assign(clans[0], body);
      return route.fulfill({ json: { data: clans[0] } });
    }
    if (path === "/api/v1/manage/clans/c1/squads") {
      const squad = { id: `s${++counter}`, slug: `s${counter}`, ...body };
      clans[0].squads.push(squad);
      return route.fulfill({ status: 201, json: { data: squad } });
    }
    if (path.startsWith("/api/v1/manage/squads/") && method === "PATCH") {
      const squad = clans[0].squads.find((s) => path.endsWith(s.id));
      Object.assign(squad, body);
      return route.fulfill({ json: { data: squad } });
    }
    if (path === "/api/v1/players")
      return route.fulfill({
        json: {
          data: players.map((p) => ({ id: p.id, current_ign: p.current_ign })),
          meta,
        },
      });
    if (path === "/api/v1/manage/players" && method === "POST") {
      const player = { id: "p1", ...body };
      players.push(player);
      return route.fulfill({ status: 201, json: { data: player } });
    }
    if (path === "/api/v1/manage/players/p1" && method === "GET")
      return route.fulfill({ json: { data: players[0] } });
    if (path === "/api/v1/manage/players/p1" && method === "PATCH") {
      Object.assign(players[0], body);
      return route.fulfill({ json: { data: players[0] } });
    }
    if (path === "/api/v1/manage/squads/s1/roster" && method === "GET")
      return route.fulfill({ json: { data: roster } });
    if (path === "/api/v1/manage/squads/s1/roster" && method === "POST") {
      roster = [
        {
          membership_id: "m1",
          player_id: body.player_id,
          ign: players[0].current_ign,
          joined_at: "2026-01-01",
        },
      ];
      return route.fulfill({ status: 201, json: { data: roster[0] } });
    }
    if (path === "/api/v1/manage/squads/s1/roster/p1" && method === "DELETE") {
      roster = [];
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 404,
      json: { message: `Not found ${path}` },
    });
  });
  await page.goto(base + "/manage/directory");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("fixture-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("No clans found.").waitFor();
  await page.getByRole("button", { name: "Create clan" }).click();
  await page.getByLabel("Clan name").fill("Kano Clan");
  await page.getByLabel("Tag").fill("KC");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Clan created.").waitFor();
  await page.getByRole("button", { name: "Edit clan" }).click();
  await page.getByLabel("Clan bio").fill("Arewa clan");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Clan updated.").waitFor();
  assert.equal(clans[0].bio, "Arewa clan");
  await page.getByRole("button", { name: "Captains" }).click();
  await page.getByText("No captains assigned.").waitFor();
  await page.getByLabel("Search accounts").fill("captain");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await page.getByText("Captain added.").waitFor();
  assert.equal(person.roles[0].scope_id, "c1");
  await page.getByText("captain@example.test").first().waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Remove", exact: true })
    .first()
    .click();
  await page.getByText("Captain removed.").waitFor();
  assert.equal(person.roles.length, 0);
  await page.getByRole("button", { name: "← Clans & players" }).click();
  await page.getByRole("button", { name: "Add squad" }).click();
  await page.getByLabel("Squad name").fill("Alpha");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Squad created.").waitFor();
  await page.getByRole("button", { name: "Add squad" }).click();
  await page.getByLabel("Squad name").fill("Bravo");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Squad created.").waitFor();
  assert.equal(clans[0].squads.length, 2);
  await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
  await page.getByLabel("Squad name").fill("Bravo Two");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Bravo Two").waitFor();
  if (width === 390 || width === 1440)
    await page.screenshot({
      path: `artifacts/directory-clans-${width}.png`,
      fullPage: true,
    });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Players", exact: true }).click();
  await page.getByRole("button", { name: "Register player" }).click();
  await page.getByLabel("Player IGN").fill("ACE");
  await page.getByLabel("CODM UID").fill("UID-1");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Player registered.").waitFor();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Player IGN").fill("ACE TWO");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("ACE TWO").waitFor();
  assert.equal(players[0].current_ign, "ACE TWO");
  await page.getByRole("button", { name: "Clans & squads" }).click();
  await page
    .getByRole("button", { name: "Roster", exact: true })
    .first()
    .click();
  await page.getByText("No players on this roster yet.").waitFor();
  await page.getByLabel("Search player IGN").fill("ACE");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await page.getByText("ACE TWO added to roster.").waitFor();
  assert.equal(roster.length, 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByText("ACE TWO removed from roster.").waitFor();
  assert.equal(roster.length, 0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(`PASS ${width}px clan, squads, player and roster workflows`);
  await page.close();
}
const errorPage = await browser.newPage({
  viewport: { width: 390, height: 900 },
});
let failClans = true;
await errorPage.route("**/api/v1/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/auth/me"))
    return route.fulfill({
      json: {
        data: {
          id: "u",
          name: "Organizer",
          email: "organizer@example.test",
          roles: [{ role: "organizer", scope_type: "global", scope_id: "*" }],
        },
      },
    });
  if (path.endsWith("/manage/clans"))
    return failClans
      ? route.fulfill({
          status: 503,
          json: { message: "Directory unavailable" },
        })
      : route.fulfill({
          json: { data: [], meta: { current_page: 1, last_page: 1, total: 0 } },
        });
  return route.fulfill({ status: 404, json: { message: "Not found" } });
});
await errorPage.goto(base + "/manage/directory");
await errorPage.evaluate(() =>
  sessionStorage.setItem("arewavanta-organizer-token", "test"),
);
await errorPage.reload();
await errorPage.getByText("Directory unavailable").waitFor();
failClans = false;
await errorPage.getByRole("button", { name: "Try again" }).click();
await errorPage.getByText("No clans found.").waitFor();
await errorPage.close();
console.log("PASS directory error and retry");
await browser.close();
