import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:4191";
const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4191"], { stdio: "ignore" });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (attempt === 99) throw new Error("Preview did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const user = { id: 1, name: "Organizer", roles: [{ role: "organizer", scope_type: "event", scope_id: "e1" }] };
  const event = { id: "e1", title: "Arewa Weekend Scrims", slug: "weekly", squad_capacity: 25, days: [], squads: [], recurrence: { id: "series", state: "active", weeks: [] } };
  const squads = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => ![2, 24, 25].includes(n)).map((n) => ({
    id: `s${n}`, name: "Squad 1", number: n === 14 ? 2 : 1,
    clan: { id: `c${n}`, name: n === 1 ? "BAGATATAS" : [13, 14].includes(n) ? "Northern Elites" : `Clan ${n}`, tag: n === 1 ? "B1" : [13, 14].includes(n) ? "NE" : `C${n}` },
    players: Array.from({ length: 4 }, (_, i) => ({ id: `p-${n}-${i}`, ign: `${n === 1 ? "B1" : "NE"} · Player ${i + 1}` })),
  }));
  const late = { id: "late1", name: "Squad 2", number: 2, clan: { id: "cnew", name: "New Clan", tag: "NEW" }, players: [] };
  const apex = { id: "apex", name: "Apex Fury", tag: "AF" };
  const choices = [...squads, late];
  let version = "1".repeat(64);
  let conflict = false;
  let saved = 0;
  let book = Array.from({ length: 25 }, (_, i) => ({ slot: i + 1, squad_id: squads.find((s) => s.id === `s${i + 1}`)?.id ?? null, reserved_clan_id: i + 1 === 24 ? apex.id : null }));
  const response = () => ({ event: { ...event, capacity: 25, permanent: true, effective_from: "2026-11-07", can_edit: true }, version, slots: book.map((slot) => ({ ...slot, squad: choices.find((s) => s.id === slot.squad_id) ?? null, reserved_clan: slot.reserved_clan_id === apex.id ? apex : null })), squads: choices, clans: [...choices.map((s) => s.clan), apex] });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/google/chrome/chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 950 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("arewavanta-organizer-token", "fixture-token"); localStorage.setItem("arewavanta-install-dismissed-until", String(Date.now() + 1000000)); });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: { data: user } });
    if (path === "/api/v1/manage/events") return route.fulfill({ json: { data: [{ ...event, match_count: 6, scored_match_count: 0, squad_count: 22, pending_submission_count: 0, start_date: "2026-11-07" }], meta: { current_page: 1, last_page: 1, total: 1 } } });
    if (path === "/api/v1/manage/events/e1") return route.fulfill({ json: { data: event } });
    if (path === "/api/v1/manage/events/e1/slots") {
      if (request.method() === "PUT") {
        const input = request.postDataJSON();
        if (conflict) return route.fulfill({ status: 409, json: { message: "Another organizer changed these slots. Reload the latest list before saving." } });
        assert.equal(input.expected_version, version);
        assert.equal(new Set(input.slots.filter((s) => s.squad_id).map((s) => s.squad_id)).size, input.slots.filter((s) => s.squad_id).length);
        saved++;
        if (saved === 1) { assert.equal(input.slots[0].squad_id, "s13"); assert.equal(input.slots[12].squad_id, "s1"); }
        book = input.slots;
        version = String(saved + 1).repeat(64);
      }
      return route.fulfill({ json: { data: response() } });
    }
    return route.fulfill({ status: 404, json: { message: "Fixture endpoint missing: " + path } });
  });
  await page.goto(origin + "/manage/competitions/e1/entries");
  await page.getByRole("heading", { name: "Permanent slots." }).waitFor();
  await page.locator(".slot-card").last().waitFor();
  assert.equal(await page.locator(".slot-card").count(), 25);
  assert.equal(await page.locator(".slot-card.is-assigned").count(), 22);
  assert.equal(await page.locator(".slot-card.is-open").count(), 2);
  assert.equal(await page.locator(".slot-card.is-reserved").count(), 1);
  assert.equal(await page.getByText("No clan squads have been submitted for this competition yet.").count(), 0);
  await mkdir("artifacts", { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Slot list overflow at ${width}`);
    await page.screenshot({ path: `artifacts/slots-${width}.png`, fullPage: true });
  }
  const search = page.getByRole("searchbox");
  await search.fill("BAGATATAS");
  assert.equal(await page.locator(".slot-card").count(), 1);
  await search.fill("");
  await page.getByRole("button", { name: "Change slot 1", exact: true }).click();
  await page.getByLabel("Assignment for slot 1", { exact: true }).selectOption("s13");
  await page.getByRole("button", { name: "Save swap", exact: true }).click();
  await page.getByText("Permanent slots updated. Upcoming unscored weekends use this list automatically.", { exact: true }).waitFor();
  assert.equal(book[0].squad_id, "s13"); assert.equal(book[12].squad_id, "s1");
  await page.getByRole("button", { name: "Change slot 1", exact: true }).click();
  await page.getByLabel("Assignment for slot 1", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(book[0].squad_id, null);
  assert.equal(await page.locator(".slot-card.is-open").count(), 3);
  await page.getByRole("button", { name: "Assign slot 2", exact: true }).click();
  await page.getByLabel("Assignment for slot 2", { exact: true }).selectOption("late1");
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(book[1].squad_id, "late1");
  await page.setViewportSize({ width: 390, height: 950 });
  await page.getByRole("button", { name: "Assign slot 25", exact: true }).click();
  await page.getByLabel("Assignment for slot 25", { exact: true }).selectOption("reserve:apex");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "artifacts/slot-editor-390.png" });
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(book[24].reserved_clan_id, "apex");
  conflict = true;
  await page.getByRole("button", { name: "Change slot 3", exact: true }).click();
  await page.getByLabel("Assignment for slot 3", { exact: true }).selectOption("late1");
  await page.getByRole("button", { name: "Save swap", exact: true }).click();
  await page.getByRole("button", { name: "Reload latest slots", exact: true }).waitFor();
  assert.equal(book[2].squad_id, "s3");
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.deepEqual(errors, []);
  console.log("25-slot list, roster display, mobile/desktop, move/swap, release, direct assignment, reservations and edit conflict protection passed.");
} finally { if (browser) await browser.close(); preview.kill(); }
