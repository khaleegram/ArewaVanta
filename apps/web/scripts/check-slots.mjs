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
  const clans = Array.from({ length: 23 }, (_, index) => ({
    id: `c${index + 1}`,
    name: index === 0 ? "BAGATATAS" : [12, 13].includes(index) ? "Northern Elites" : `Clan ${index + 1}`,
    tag: index === 0 ? "B1" : [12, 13].includes(index) ? "NE" : `C${index + 1}`,
  }));
  const newClan = { id: "cnew", name: "New Clan", tag: "NEW" };
  const apex = { id: "apex", name: "Apex Fury", tag: "AF" };
  const clanChoices = [...clans, newClan, apex];
  const squadForSlot = (slot) => slot === 1 ? clans[0] : [13, 14].includes(slot) ? clans[12] : clans[slot - 1];
  let nextSquad = 0;
  const squads = [];
  const makeSquad = (clan, slot) => {
    const squad = { id: `hidden-${slot}-${++nextSquad}`, name: `Squad ${nextSquad}`, number: nextSquad, clan, players: [] };
    squads.push(squad);
    return squad;
  };
  let version = "1".repeat(64);
  let conflict = false;
  let saved = 0;
  let book = Array.from({ length: 25 }, (_, index) => {
    const slot = index + 1;
    if ([2, 25].includes(slot)) return { slot, squad_id: null, reserved_clan_id: null };
    if (slot === 24) return { slot, squad_id: null, reserved_clan_id: apex.id };
    return { slot, squad_id: makeSquad(squadForSlot(slot), slot).id, reserved_clan_id: null };
  });
  const response = () => ({
    event: { ...event, capacity: 25, permanent: true, effective_from: "2026-11-07", can_edit: true },
    version,
    slots: book.map((slot) => ({ ...slot, squad: squads.find((squad) => squad.id === slot.squad_id) ?? null, reserved_clan: clanChoices.find((clan) => clan.id === slot.reserved_clan_id) ?? null })),
    squads,
    clans: clanChoices,
  });
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
        saved++;
        book = input.slots.map((slot) => {
          let squadId = slot.squad_id ?? null;
          if (slot.new_clan_id) {
            const clan = clanChoices.find((entry) => entry.id === slot.new_clan_id);
            assert.ok(clan, `Unknown clan ${slot.new_clan_id}`);
            squadId = makeSquad(clan, slot.slot).id;
          }
          return { slot: slot.slot, squad_id: squadId, reserved_clan_id: slot.reserved_clan_id ?? null };
        });
        assert.equal(new Set(book.filter((slot) => slot.squad_id).map((slot) => slot.squad_id)).size, book.filter((slot) => slot.squad_id).length);
        version = String(saved + 1).repeat(64);
      }
      return route.fulfill({ json: { data: response() } });
    }
    return route.fulfill({ status: 404, json: { message: "Fixture endpoint missing: " + path } });
  });
  await page.goto(origin + "/manage/competitions/e1/entries");
  await page.getByRole("heading", { name: "Clan slots." }).waitFor();
  await page.locator(".slot-card").last().waitFor();
  assert.equal(await page.locator(".slot-card").count(), 25);
  assert.equal(await page.locator(".slot-card.is-assigned").count(), 22);
  assert.equal(await page.locator(".slot-card.is-open").count(), 2);
  assert.equal(await page.locator(".slot-card.is-reserved").count(), 1);
  assert.equal(await page.getByText("Player 1", { exact: true }).count(), 0);
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
  await page.getByLabel("Assignment for slot 1", { exact: true }).selectOption("new:c13");
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.getByText("Slot assignments updated.", { exact: true }).waitFor();
  assert.equal(book[0].squad_id, squads.filter((squad) => squad.clan.id === "c13").at(-1)?.id);
  await page.locator(".slot-card").first().getByText("Northern Elites", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Change slot 3", exact: true }).click();
  await page.getByLabel("Assignment for slot 3", { exact: true }).selectOption("release");
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(book[2].squad_id, null);
  assert.equal(await page.locator(".slot-card.is-open").count(), 3);
  await page.getByRole("button", { name: "Assign slot 2", exact: true }).click();
  await page.getByLabel("Assignment for slot 2", { exact: true }).selectOption("new:cnew");
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(book[1].squad_id, squads.find((squad) => squad.clan.id === "cnew")?.id);
  await page.setViewportSize({ width: 390, height: 950 });
  await page.getByRole("button", { name: "Assign slot 25", exact: true }).click();
  await page.getByLabel("Assignment for slot 25", { exact: true }).selectOption("reserve:apex");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "artifacts/slot-editor-390.png" });
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(book[24].reserved_clan_id, "apex");
  const beforeConflict = book[3].squad_id;
  conflict = true;
  await page.getByRole("button", { name: "Change slot 4", exact: true }).click();
  await page.getByLabel("Assignment for slot 4", { exact: true }).selectOption("new:cnew");
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.getByRole("button", { name: "Reload latest slots", exact: true }).waitFor();
  assert.equal(book[3].squad_id, beforeConflict);
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.deepEqual(errors, []);
  console.log("25-slot clan list, mobile/desktop, direct clan assignment, release, reservations and edit conflict protection passed.");
} finally { if (browser) await browser.close(); preview.kill(); }
