import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { chromium } from '@playwright/test';

const apiBase = 'http://localhost:8000/api/v1';
const apiDir = new URL('../../api/', import.meta.url).pathname;
const webBase = process.env.WEB_URL ?? 'http://localhost:5173';
const suffix = Date.now().toString(36).toUpperCase();
const prefix = `AGA3D${suffix}`;
const authFile = `${apiDir}storage/app/${prefix.toLowerCase()}-auth.json`;
let token = '';
let userId = '';
let seasonId = '';
let eventId = '';
let eventSlug = '';
let clanId = '';
const squadIds = [];
const playerIds = [];
const mark = (label) => console.log(`PASS ${label}`);

async function request(path, { method = 'GET', body, auth = true, expected = [200] } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  assert(expected.includes(response.status), `${method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}
function psql(sql) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'aga', '-d', 'aga', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { cwd: apiDir, encoding: 'utf8' }).trim();
}
function cleanup() {
  if (!userId && !eventId && !seasonId && !clanId) return;
  const q = (value) => `'${value}'`;
  const event = /^[0-9A-HJKMNP-TV-Z]{26}$/.test(eventId) ? q(eventId) : null;
  const season = /^[0-9A-HJKMNP-TV-Z]{26}$/.test(seasonId) ? q(seasonId) : null;
  const clan = /^[0-9A-HJKMNP-TV-Z]{26}$/.test(clanId) ? q(clanId) : null;
  const squads = squadIds.filter((id) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)).map(q);
  const players = playerIds.filter((id) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)).map(q);
  const user = /^[0-9]+$/.test(String(userId)) ? q(userId) : null;
  const sql = ['BEGIN;'];
  if (event) {
    sql.push(`DELETE FROM revision_player_results WHERE revision_id IN (SELECT r.id FROM match_result_revisions r JOIN matches m ON m.id=r.match_id JOIN event_days d ON d.id=m.event_day_id WHERE d.event_id=${event});`);
    sql.push(`DELETE FROM match_squad_results WHERE revision_id IN (SELECT r.id FROM match_result_revisions r JOIN matches m ON m.id=r.match_id JOIN event_days d ON d.id=m.event_day_id WHERE d.event_id=${event});`);
    sql.push(`UPDATE matches SET current_published_revision_id=NULL WHERE event_day_id IN (SELECT id FROM event_days WHERE event_id=${event});`);
    sql.push(`DELETE FROM match_result_revisions WHERE match_id IN (SELECT m.id FROM matches m JOIN event_days d ON d.id=m.event_day_id WHERE d.event_id=${event});`);
    sql.push(`DELETE FROM matches WHERE event_day_id IN (SELECT id FROM event_days WHERE event_id=${event});`);
    sql.push(`DELETE FROM event_squads WHERE event_id=${event}; DELETE FROM event_days WHERE event_id=${event}; DELETE FROM events WHERE id=${event};`);
  }
  if (season) sql.push(`DELETE FROM seasons WHERE id=${season};`);
  if (squads.length || clan) {
    const conditions = [...(squads.length ? [`squad_id IN (${squads.join(',')})`] : []), ...(clan ? [`squad_id IN (SELECT id FROM squads WHERE clan_id=${clan})`] : [])].join(' OR ');
    sql.push(`DELETE FROM squad_memberships WHERE ${conditions};`);
    if (squads.length) sql.push(`DELETE FROM squads WHERE id IN (${squads.join(',')});`);
  }
  if (players.length) sql.push(`DELETE FROM squad_memberships WHERE player_id IN (${players.join(',')}); DELETE FROM players WHERE id IN (${players.join(',')});`);
  if (clan) sql.push(`DELETE FROM role_assignments WHERE scope_type='clan' AND scope_id=${clan}; DELETE FROM clans WHERE id=${clan};`);
  if (user) sql.push(`DELETE FROM audit_logs WHERE actor_user_id=${user}; DELETE FROM users WHERE id=${user};`);
  sql.push('COMMIT;');
  psql(sql.join('\n'));
}

let browser;
try {
  const php = `require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $password=Illuminate\\Support\\Str::random(48); $user=App\\Models\\User::query()->create(['name'=>'ArewaVanta Verification','email'=>'${prefix.toLowerCase()}@example.test','password'=>$password]); $user->roleAssignments()->create(['role'=>'organizer','scope_type'=>'global','scope_id'=>'*']); file_put_contents('storage/app/${prefix.toLowerCase()}-auth.json',json_encode(['id'=>$user->id,'email'=>$user->email,'password'=>$password]),LOCK_EX); chmod('storage/app/${prefix.toLowerCase()}-auth.json',0600);`;
  execFileSync('docker', ['compose', 'exec', '-T', 'api', 'php', '-r', php], { cwd: apiDir, stdio: 'ignore' });
  const auth = JSON.parse(readFileSync(authFile, 'utf8'));
  userId = auth.id;
  assert.match(String(userId), /^\d+$/);
  const login = await request('/auth/login', { method: 'POST', auth: false, body: { email: auth.email, password: auth.password, device_name: 'phase-3d-verification' } });
  token = login.data.token;
  unlinkSync(authFile);
  const organizer = await request('/auth/me');
  assert(organizer.data.roles.some((role) => role.role === 'organizer'));
  mark('created an isolated organizer and authenticated through the live Laravel login endpoint');

  const season = await request('/manage/seasons', { method: 'POST', expected: [201], body: { name: `${prefix} Season`, starts_on: '2026-11-01', ends_on: '2026-12-31' } });
  seasonId = season.data.id;
  const clan = await request('/manage/clans', { method: 'POST', expected: [201], body: { name: `${prefix} Clan`, tag: prefix.slice(-12) } });
  clanId = clan.data.id;
  const firstSquad = await request(`/manage/clans/${clanId}/squads`, { method: 'POST', expected: [201], body: { name: `${prefix} First`, tag: 'ONE' } });
  const secondSquad = await request(`/manage/clans/${clanId}/squads`, { method: 'POST', expected: [201], body: { name: `${prefix} Second`, tag: 'TWO' } });
  squadIds.push(firstSquad.data.id, secondSquad.data.id);
  const names = [`${prefix} Archer`, `${prefix} Archer Reserve`, `${prefix} Anchor`, `${prefix} Alpha`];
  const players = [];
  for (const current_ign of names) {
    const created = await request('/manage/players', { method: 'POST', expected: [201], body: { current_ign } });
    players.push(created.data); playerIds.push(created.data.id);
  }
  mark('created unique development clan, squads, season, and players through real API');

  const presetData = await request('/manage/scoring-presets');
  const presets = presetData.data;
  const balanced = presets.find((p) => p.name === 'ArewaVanta Balanced').versions[0];
  const asRules = (version) => ({ mode: version.mode, kill_point_value: version.kill_point_value, maximum_position: version.maximum_position, fallback_placement_points: version.fallback_placement_points, fallback_multiplier: version.fallback_multiplier, tiers: version.tiers });
  const modes = ['ArewaVanta Balanced', 'Warzone-Style Multiplier', 'Kills Only', 'Placement Only'];
  const expectedScores = ['19', '18.0', '10', '9'];
  for (let i = 0; i < modes.length; i++) {
    const version = presets.find((p) => p.name === modes[i]).versions[0];
    const response = await request('/manage/scoring-preview', { method: 'POST', body: { rules: asRules(version), team_kills: 10, placement: 2 } });
    assert.equal(String(response.data.total_points), expectedScores[i], `${modes[i]} preview`);
  }
  const custom = await request('/manage/scoring-preview', { method: 'POST', body: { team_kills: 10, placement: 1, rules: { mode: 'multiplier', kill_point_value: '1.25', maximum_position: 25, fallback_multiplier: '1', tiers: [{ position_from: 1, position_to: 1, multiplier: '2.5' }, { position_from: 2, position_to: 25, multiplier: '1' }] } } });
  assert.equal(String(custom.data.total_points), '31.25');
  mark('server scoring preview: Balanced, Warzone multiplier, kills-only, placement-only, custom decimal rules');

  const createdEvent = await request('/manage/events', { method: 'POST', expected: [201], body: { title: `${prefix} Weekend Scrim`, description: 'Temporary Phase 3D verification event.', competition_type: 'scrim', season_id: seasonId, scoring_rule_version_id: balanced.id, dates: ['2026-11-07', '2026-11-08'], squad_capacity: 20, timezone: 'Africa/Lagos', maximum_position: 25, squad_size: 4, visibility: 'public' } });
  eventId = createdEvent.data.id; eventSlug = createdEvent.data.slug;
  for (const squadId of squadIds) {
    await request(`/manage/squads/${squadId}/event-submissions`, { method: 'POST', expected: [201], body: { event_id: eventId } });
  }
  const submissionReview = await request(`/manage/events/${eventId}/submissions`);
  for (const clan of submissionReview.data.clans) {
    for (const squad of clan.squads) {
      await request(`/manage/events/${eventId}/submissions/${squad.submission_id}`, { method: 'PATCH', body: { decision: 'select' } });
    }
  }
  assert.equal(createdEvent.data.days.length, 2); assert.equal(createdEvent.data.days.reduce((sum, day) => sum + day.matches.length, 0), 6);
  assert.deepEqual(createdEvent.data.days.flatMap((day) => day.matches.map((match) => match.map_label)), ['Isolated', 'Isolated', 'Blackout', 'Isolated', 'Isolated', 'Blackout']);
  mark('created six configured Isolated/Blackout weekend games and attached the test season');

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (error) => { throw error; });
  await page.addInitScript((value) => sessionStorage.setItem('arewavanta-organizer-token', value), token);
  await page.goto(`${webBase}/manage/directory`);
  await page.getByRole('heading', { name: /Clans & players/ }).waitFor();
  const clanArticle = page.locator('.directory-clan').filter({ hasText: `${prefix} Clan` });
  await clanArticle.waitFor();
  await clanArticle.getByRole('button', { name: 'Roster' }).nth(0).click();
  const search = page.getByPlaceholder('Type player IGN');
  await search.fill(names[0]);
  await page.getByText(names[1], { exact: true }).waitFor();
  const similarRows = page.locator('.directory-player-row').filter({ hasText: prefix });
  assert((await similarRows.count()) >= 2, 'similar IGN results should both be visible');
  for (const name of [names[0], names[1]]) {
    await search.fill(name); const row = page.getByText(name, { exact: true }).locator('xpath=..');
    await row.getByRole('button', { name: /Add/ }).click();
    await page.getByText(`${name} added to this squad.`, { exact: true }).waitFor();
  }
  await page.getByRole('button', { name: /Clans & players/ }).click();
  await clanArticle.waitFor(); await clanArticle.getByRole('button', { name: 'Roster' }).nth(1).click();
  for (const name of [names[2], names[3]]) {
    await search.fill(name); const row = page.getByText(name, { exact: true }).locator('xpath=..');
    await row.getByRole('button', { name: /Add/ }).click();
    await page.getByText(`${name} added to this squad.`, { exact: true }).waitFor();
  }
  const autoCreated = `${prefix} Fresh Player`;
  await search.fill(autoCreated); await page.getByText(/No matching players/).waitFor();
  await page.getByRole('button', { name: 'Add player' }).click();
  await page.getByText(`${autoCreated} created and added to this squad.`, { exact: true }).waitFor();
  const rosterCheck = await request(`/manage/squads/${secondSquad.data.id}/roster`);
  const newProfile = rosterCheck.data.find((member) => member.ign === autoCreated); assert(newProfile); playerIds.push(newProfile.player_id);
  await page.getByRole('button', { name: /Clans & players/ }).click();
  await page.waitForFunction(([firstName, newName]) => {
    const rosters = [...document.querySelectorAll('.directory-squad-players')].map((row) => row.textContent ?? '');
    return rosters.some((text) => text.includes(firstName)) && rosters.some((text) => text.includes(newName));
  }, [names[0], autoCreated]);
  mark('real player search, similar-name selection, roster insertion, automatic player creation, and squad roster display');

  const browserToken = token;
  const pageOne = await browser.newPage({ viewport: { width: 360, height: 844 } });
  const pageTwo = await browser.newPage({ viewport: { width: 430, height: 844 } });
  for (const target of [pageOne, pageTwo]) await target.addInitScript((value) => sessionStorage.setItem('arewavanta-organizer-token', value), browserToken);
  await Promise.all([pageOne.goto(`${webBase}/manage/competitions/${eventId}/results`), pageTwo.goto(`${webBase}/manage/competitions/${eventId}/results`)]);
  for (const target of [pageOne, pageTwo]) { await target.locator('.results-day').first().getByRole('button', { name: /Game 1/ }).click(); await target.getByText(`${prefix} First`, { exact: true }).waitFor(); }
  async function enter(target, { placementA = '1', placementB = '2', killsA = '10', reserve = false } = {}) {
    const rows = target.locator('.results-squad');
    const a = rows.nth(0), b = rows.nth(1);
    await a.locator('.results-participate input').check(); await b.locator('.results-participate input').check();
    await a.getByLabel('Placement').fill(placementA); await b.getByLabel('Placement').fill(placementB);
    await a.getByLabel(names[0], { exact: true }).check();
    if (reserve) { await a.getByLabel(names[0], { exact: true }).uncheck(); await a.getByLabel(names[1], { exact: true }).check(); }
    await b.getByLabel(names[2], { exact: true }).check();
    const aKills = a.getByLabel('Kills'); await aKills.fill(killsA);
    await b.getByLabel('Kills').fill('4');
  }
  await enter(pageOne); await enter(pageTwo, { killsA: '99' });
  assert.equal(await pageOne.locator('input[type="number"]').first().getAttribute('inputmode'), 'numeric');
  await pageOne.locator('.results-squad').nth(1).getByLabel('Placement').fill('1');
  await pageOne.getByRole('button', { name: 'Save results' }).click();
  await pageOne.getByText('Placement is already used.').first().waitFor();
  assert.equal(await pageOne.getByText('Placement is already used.').count(), 2);
  assert.equal(await pageOne.locator('.results-squad').nth(0).getByLabel('Kills').inputValue(), '10');
  assert.equal(await pageOne.locator('.results-squad').nth(1).getByLabel('Placement').inputValue(), '1');
  await pageOne.locator('.results-squad').nth(1).getByLabel('Placement').fill('2');
  await pageOne.getByRole('button', { name: 'Save results' }).click();
  await pageOne.getByText('Results saved. Standings and player statistics are updated.').waitFor();
  const matchId = createdEvent.data.days[0].matches[0].id;
  let match = await request(`/matches/${matchId}/results`);
  assert.equal(match.data.result.results.find((row) => row.squad_id === firstSquad.data.id).team_kills, 10);
  assert.equal(match.data.result.results.find((row) => row.squad_id === firstSquad.data.id).total_points, '22.0000');
  assert.equal(match.data.result.results.find((row) => row.squad_id === secondSquad.data.id).total_points, '13.0000');
  const savedVersion = match.data.result.lock_version;
  await pageTwo.getByRole('button', { name: 'Save results' }).click();
  await pageTwo.getByText(/changed after you opened this sheet/).waitFor();
  pageTwo.once('dialog', (dialog) => dialog.accept());
  await pageTwo.getByRole('button', { name: 'Reload latest results' }).click();
  await pageTwo.locator('.results-squad').nth(0).getByLabel('Kills').waitFor();
  assert.equal(await pageTwo.locator('.results-squad').nth(0).getByLabel('Kills').inputValue(), '10');
  mark('live API initial save, calculated Balanced scores, duplicate placement validation, and stale-sheet HTTP 409 protection');

  await pageOne.locator('.results-squad').nth(0).getByLabel(names[0], { exact: true }).uncheck();
  await pageOne.locator('.results-squad').nth(0).getByLabel(names[1], { exact: true }).check();
  await pageOne.locator('.results-squad').nth(0).getByLabel('Kills').fill('12');
  await pageOne.locator('.results-squad').nth(0).getByLabel('Placement').fill('2');
  await pageOne.locator('.results-squad').nth(1).getByLabel('Placement').fill('1');
  await pageOne.getByRole('button', { name: 'Save results' }).click();
  await pageOne.getByText('Results saved. Standings and player statistics are updated.').waitFor();
  match = await request(`/matches/${matchId}/results`);
  assert.equal(match.data.result.results.find((row) => row.squad_id === firstSquad.data.id).team_kills, 12);
  assert.equal(match.data.result.results.find((row) => row.squad_id === firstSquad.data.id).total_points, '21.0000');
  assert(match.data.result.lock_version > savedVersion);
  mark('corrected live result and substituted the actual player; old roster/history stays attributable');

  const warzone = presets.find((p) => p.name === 'Warzone-Style Multiplier').versions[0];
  await request(`/manage/matches/${matchId}/scoring`, { method: 'PATCH', body: { scoring_rule_version_id: warzone.id } });
  await pageOne.reload(); await pageOne.locator('.results-day').first().getByRole('button', { name: /Game 1/ }).click();
  await pageOne.getByText('Saved score: 21.6 pts').waitFor();
  match = await request(`/matches/${matchId}/results`);
  assert.equal(match.data.result.results.find((row) => row.squad_id === firstSquad.data.id).total_points, '21.6000');
  const eventStandings = await request(`/events/${eventSlug}/standings`);
  assert.equal(eventStandings.data.standings[0].total_points, '21.6');
  const seasonStandings = await request(`/seasons/${seasonId}/standings`);
  assert.equal(seasonStandings.data.standings[0].total_points, '21.6');

  const storedScore = psql(`SELECT team_kills::text || ':' || total_points::text FROM match_squad_results WHERE revision_id=(SELECT current_published_revision_id FROM matches WHERE id='${matchId}') AND squad_id='${firstSquad.data.id}'`);
  assert.equal(storedScore, '12:21.6000');
  const storedPlayers = psql(`SELECT string_agg(ign_snapshot || ':' || kills::text, ',' ORDER BY ign_snapshot) FROM revision_player_results WHERE revision_id=(SELECT current_published_revision_id FROM matches WHERE id='${matchId}') AND match_squad_result_id IN (SELECT id FROM match_squad_results WHERE squad_id='${firstSquad.data.id}' AND revision_id=(SELECT current_published_revision_id FROM matches WHERE id='${matchId}'))`);
  assert.equal(storedPlayers, `${names[1]}:12`);
  mark('PostgreSQL current revision stores the corrected squad score and substituted player contribution');

  await pageOne.goto(`${webBase}/manage/directory`);
  await pageOne.getByRole('heading', { name: /Clans & players/ }).waitFor();
  const firstClan = pageOne.locator('.directory-clan').filter({ hasText: `${prefix} Clan` });
  await firstClan.getByRole('button', { name: 'Roster' }).nth(0).click();
  const reserveRow = pageOne.locator('.directory-player-row').filter({ hasText: names[1] });
  pageOne.once('dialog', (dialog) => dialog.accept());
  await reserveRow.getByRole('button', { name: 'Remove' }).click();
  await pageOne.getByText(`${names[1]} removed from this squad.`, { exact: true }).waitFor();
  const updatedRoster = await request(`/manage/squads/${firstSquad.data.id}/roster`);
  assert(!updatedRoster.data.some((member) => member.player_id === playerIds[1]));
  mark('organizer can remove a roster member; completed match participation remains stored');

  const playerProfile = await request(`/players/${playerIds[1]}`);
  assert.equal(playerProfile.data.total_kills, 12); assert.equal(playerProfile.data.appearances, 1);
  assert.equal(playerProfile.data.match_history[0].kills, 12);
  const formerPlayer = await request(`/players/${playerIds[0]}`);
  assert.equal(formerPlayer.data.appearances, 0);
  const playerRanks = await request('/rankings/players');
  assert(playerRanks.data.some((row) => row.id === playerIds[1] && row.total_kills === 12));
  const squadProfile = await request(`/squads/${firstSquad.data.slug}`);
  assert.equal(squadProfile.data.name, firstSquad.data.name);
  const publicEvent = await request(`/events/${eventSlug}`);
  assert(publicEvent.data.days[0].matches[0].has_results);
  const home = await request('/events'); assert(home.data.some((row) => row.slug === eventSlug));

  const publicPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  publicPage.on('pageerror', (error) => { throw error; });
  let squadHistoryRequests = 0;
  publicPage.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith(`/squads/${firstSquad.data.slug}/history`)) squadHistoryRequests++;
  });
  await publicPage.goto(`${webBase}/competitions/${eventSlug}/games/${matchId}`);
  await publicPage.getByRole('heading', { name: 'Match results.' }).waitFor();
  await publicPage.getByRole('heading', { name: `${prefix} First` }).waitFor();
  await publicPage.getByRole('link', { name: names[1], exact: true }).waitFor();
  const publicPlayerRow = publicPage.locator('.public-player-table tr').filter({ hasText: names[1] });
  assert.equal((await publicPlayerRow.locator('td').innerText()).trim(), '12');

  await publicPage.goto(`${webBase}/competitions/${eventSlug}`);
  await publicPage.getByRole('heading', { name: `${prefix} Weekend Scrim.` }).waitFor();
  await publicPage.getByRole('button', { name: 'Standings', exact: true }).click();
  await publicPage.getByRole('heading', { name: 'Overall standings.' }).waitFor();
  await publicPage.getByText(`${prefix} First`, { exact: true }).waitFor();
  await publicPage.getByText('21.6', { exact: true }).waitFor();

  await publicPage.goto(`${webBase}/leaderboard?type=squads&season=${seasonId}`);
  const seasonRankingRow = publicPage.locator('.lb-table tbody tr.lb-result-row').filter({ hasText: `${prefix} First` });
  await seasonRankingRow.waitFor();
  assert((await seasonRankingRow.innerText()).includes('21.6'));

  await publicPage.goto(`${webBase}/squads/${firstSquad.data.slug}`);
  await publicPage.getByRole('heading', { name: `${prefix} First.` }).waitFor();
  await publicPage.getByRole('heading', { name: 'Competition history.' }).waitFor();
  await publicPage.getByText(`${prefix} Weekend Scrim`, { exact: true }).waitFor();
  assert.equal(squadHistoryRequests, 2, 'development StrictMode runs this one history request twice; production runs it once');
  assert.equal(await publicPage.getByRole('link', { name: names[1], exact: true }).count(), 0, 'removed player should no longer appear on the current roster');

  await publicPage.goto(`${webBase}/players/${playerIds[1]}`);
  await publicPage.getByRole('heading', { name: `${names[1]}.` }).waitFor();
  await publicPage.getByText('12', { exact: true }).first().waitFor();
  await publicPage.getByRole('heading', { name: 'Match history.' }).waitFor();
  await publicPage.getByText('Played for', { exact: false }).waitFor();

  await publicPage.goto(`${webBase}/leaderboard?type=players`);
  await publicPage.locator('.lb-table tbody tr.lb-result-row').filter({ hasText: names[1] }).waitFor();

  await publicPage.goto(`${webBase}/`);
  await publicPage.getByRole('heading', { name: 'Latest standings.' }).waitFor();
  await publicPage.getByText(`${prefix} Weekend Scrim`, { exact: true }).waitFor();
  await publicPage.getByText('21.6', { exact: true }).waitFor();
  mark('public match results, event and season standings, squad/player profiles, global player rankings, and homepage render current live results');

  await pageOne.goto(`${webBase}/manage/competitions/${eventId}/results`);
  await pageOne.locator('.results-day').first().getByRole('button', { name: /Game 1/ }).click();
  await pageOne.locator('.results-squad').nth(0).waitFor();
  for (const width of [360, 390, 430, 768, 1440]) {
    await pageOne.setViewportSize({ width, height: 850 });
    assert.equal(await pageOne.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `result entry overflow at ${width}px`);
  }
  await pageOne.setViewportSize({ width: 390, height: 844 });
  await pageOne.addStyleTag({ content: '.results-save { position: static !important; }' });
  await pageOne.screenshot({ path: '/tmp/arewavanta-results-live-mobile.png', fullPage: true });
  await pageOne.setViewportSize({ width: 1440, height: 900 });
  await pageOne.screenshot({ path: '/tmp/arewavanta-results-live-desktop.png', fullPage: true });
  mark('real API organizer page has no horizontal overflow at 360, 390, 430, 768, or 1440 px');

  console.log('PASS all end-to-end checks used the live Laravel API and PostgreSQL development database.');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (eventId && token) await request(`/manage/events/${eventId}`, { method: 'DELETE', expected: [204] }).catch(() => {});
  try { cleanup(); console.log('PASS uniquely identified verification records removed from the development database'); }
  catch (error) { console.error('CLEANUP FAILED: verification records may remain; error:', error.message); process.exitCode = 1; }
  try { unlinkSync(authFile); } catch {}
}
