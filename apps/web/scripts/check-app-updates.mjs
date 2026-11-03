import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";

const dist = resolve("dist");
const actualRelease = JSON.parse(await readFile(resolve(dist, "release.json"), "utf8")).buildId;
let release = actualRelease;
let legacy = false;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (path === "/release.json") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ buildId: release })); return; }
  if (path === "/seed") { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Seed legacy worker</title>"); return; }
  if (path === "/service-worker.js" && legacy) {
    response.setHeader("Content-Type", "application/javascript");
    response.end(`self.addEventListener('install', e => e.waitUntil((async()=>{await (await caches.open('arewavanta-shell-v1')).put('/old.html',new Response('old UI'));await (await caches.open('arewavanta-assets-v1')).put('/old.js',new Response('old bundle'));await self.skipWaiting()})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));`); return;
  }
  try {
    const requested = resolve(dist, "." + path);
    if (!requested.startsWith(dist + "/")) throw new Error("Not a file");
    const file = extname(path) ? requested : resolve(dist, "index.html");
    response.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".svg": "image/svg+xml" })[extname(file)] || "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(4189, "127.0.0.1", done));
const origin = "http://127.0.0.1:4189";
const user = { id: 1, name: "Organizer", roles: [{ role: "organizer", scope_type: "global", scope_id: "*" }] };
const clans = [
  { id: "c1", name: "Northern Elites", tag: "NE", slug: "northern-elites", squads: [{ id: "s1", name: "Squad 1", squad_number: 1 }, { id: "s2", name: "Squad 2", squad_number: 2 }] },
  { id: "c2", name: "BAGATATAS", tag: "B1", slug: "bagatatas", squads: [{ id: "s3", name: "Squad 1", squad_number: 1 }] },
];
const teams = clans.flatMap((clan) => clan.squads.map((squad, index) => ({ ...squad, clan: clan.name, clan_id: clan.id, clan_tag: clan.tag, clan_squad_count: clan.squads.length, slot_number: index + 1, roster_players: [{ id: "p-" + squad.id, ign: clan.tag + " Player" }], eligible_players: [{ id: "p-" + squad.id, ign: clan.tag + " Player" }] })));
const game = { id: "m1", map_label: "Blackout", match_index: 3, has_results: true };
const event = { id: "e1", title: "Arewa Weekend Scrims", slug: "weekend", days: [{ id: "d1", label: "Sunday", date: "2026-11-01", matches: [game] }] };
const sheet = {
  event: { id: "e1", title: event.title, slug: "weekend", timezone: "Africa/Lagos", squad_size: 4, maximum_position: 25 },
  match: { ...game, date: "2026-11-01", scoring: { version_id: "v1", rules: { mode: "additive", kill_point_value: "1.00", tiers: [], maximum_position: 25, fallback_placement_points: "0.00" } } },
  squads: teams, result: { saved_at: "2026-11-02", lock_version: 1, results: teams.map((s) => ({ squad_id: s.id, participation_status: "present", placement: 2, team_kills: 4, team_kills_override: null, kills_confirmed: true, players: [{ player_id: "p-" + s.id, ign: "Player", kills: 4 }] })) },
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/google/chrome/chrome", headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => { localStorage.setItem("arewavanta-organizer-token", "fixture-token"); localStorage.setItem("arewavanta-install-dismissed-until", String(Date.now() + 1000000)); });
  await context.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path.endsWith("/auth/me")) data = user;
    else if (path.endsWith("/manage/clans")) data = clans;
    else if (path.endsWith("/manage/events/e1")) data = event;
    else if (path.endsWith("/result-sheet")) data = sheet;
    else if (path.endsWith("/manage/clans/c1/players")) data = [{ id: "p1", current_ign: "NE・Player one", squads: [] }];
    else if (path.endsWith("/manage/clans/c2/players")) data = [{ id: "p2", current_ign: "B1 Player", squads: [] }];
    else if (path.endsWith("/players")) data = [];
    else return route.fulfill({ status: 404, json: { message: "Fixture endpoint missing: " + path } });
    return route.fulfill({ json: { data, meta: { current_page: 1, last_page: 1, total: Array.isArray(data) ? data.length : 1 } } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  legacy = true;
  await page.goto(origin + "/seed");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    await (await caches.open("unrelated-data")).put("/keep", new Response("keep"));
    localStorage.setItem("arewavanta-preserved-score-draft", "unsaved-score");
  });
  legacy = false;
  await page.goto(origin + "/manage/directory");
  await page.getByRole("heading", { name: "Clans & players." }).waitFor();
  await page.waitForFunction(async () => !(await caches.keys()).some((key) => key === "arewavanta-assets-v1" || key === "arewavanta-shell-v1"));
  assert.ok(await page.evaluate(async () => (await caches.keys()).includes("unrelated-data")));
  assert.equal(await page.evaluate(() => localStorage.getItem("arewavanta-preserved-score-draft")), "unsaved-score");
  assert.equal(await page.locator(".directory-compact-clan").count(), 2);
  assert.equal(await page.locator(".directory-clan-body").count(), 0);
  await page.getByRole("button", { name: /Northern Elites/ }).click();
  await page.getByText("NE・Player one").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Add new player" }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Monthly report" }).count(), 1);
  assert.equal(await page.getByText("Submit to competition", { exact: true }).count(), 0);
  assert.equal(await page.locator(".manage-header").evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(255, 254, 250)");
  await mkdir("artifacts", { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Directory overflow: ${width}`);
    await page.screenshot({ path: `artifacts/directory-current-${width}.png`, fullPage: true });
  }
  console.log("Compact directory, clan player pool, persistent login and legacy cache cleanup passed.");
  await page.goto(origin + "/manage/competitions/e1/results?match=m1");
  await page.getByRole("heading", { name: "Enter results." }).waitFor();
  await page.locator(".score-team").first().waitFor();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Results overflow: ${width}`);
    await page.screenshot({ path: `artifacts/results-current-${width}.png`, fullPage: true });
  }
  const input = page.locator(".score-place input").first();
  await input.fill("3");
  await page.waitForFunction(() => document.querySelector('[data-unsaved="true"]'));
  let navigations = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
  release = "next-release-1234";
  await page.waitForTimeout(5100);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText("A new version is ready", { exact: true }).waitFor();
  await page.waitForTimeout(2200);
  assert.equal(navigations, 0, "An update must not discard unsaved results");
  assert.equal(await input.inputValue(), "3");
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("arewavanta-score-draft:"))));
  release = actualRelease;
  await input.fill("2");
  await page.locator(".score-page-heading").click();
  await page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame() });
  await page.getByRole("heading", { name: "Enter results." }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("arewavanta-organizer-token")), "fixture-token");
  assert.equal(navigations, 1, "The safe update should reload once");
  for (const [path, selector] of [["/manage/clans/c1/reports", ".monthly-page"], ["/manage/competitions/e1/check-in", ".check-in-page"], ["/manage/organizers", ".crew-page"]]) {
    await page.goto(origin + path);
    await page.locator(selector).waitFor();
    assert.equal(await page.getByText("Page not found", { exact: true }).count(), 0);
    assert.equal(await page.locator(".manage-page.studio-shell").count(), 1);
  }
  assert.deepEqual(errors, []);
  console.log("Release update deferred for unsaved scores, applied automatically when safe, and preserved authentication.");
  await context.close();
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
