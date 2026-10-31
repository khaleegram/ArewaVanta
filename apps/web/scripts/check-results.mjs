import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({channel:'chrome', headless:true});
const user = {id:'u',name:'Organizer',roles:[]};
const squads = Array.from({length:22},(_,i)=>({id:`s${i}`, name:`Squad ${i+1}`, clan:`Clan ${i+1}`, tag:null, eligible_players:[{id:`p${i}`,ign:`Player ${i+1}`},{id:`sub${i}`,ign:`Sub ${i+1}`}]}));
const match = {id:'m1',match_index:1,map_label:'Isolated',has_results:false};
const event = {id:'e1',title:'Weekend Scrims',days:[{id:'d1',label:'Saturday',date:'2026-10-31',matches:[match]}]};
let saved = null;
for (const width of [360,390,430,768,1440]) {
 const page = await browser.newPage({viewport:{width,height:900}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('arewavanta-organizer-token','token'));
 await page.route('**/api/v1/**',async route=>{const req=route.request(), path=new URL(req.url()).pathname;
   if(path.endsWith('/auth/me')) return route.fulfill({json:{data:user}});
   if(path.endsWith('/manage/events/e1')) return route.fulfill({json:{data:event}});
   if(path.endsWith('/result-sheet')) return route.fulfill({json:{data:{event:{id:'e1',title:event.title,slug:'weekend',timezone:'Africa/Lagos',squad_size:4,maximum_position:25},match:{id:'m1',date:'2026-10-31',match_index:1,map_label:'Isolated',scoring:{}},squads,result:saved}}});
   if(path.endsWith('/matches/m1/results') && req.method()==='PUT') { const body=req.postDataJSON(); assert.equal(body.results.length,2); assert.deepEqual(body.results[0].players,[{player_id:'p0',kills:4}]); saved={saved_at:'2026-10-31',results:body.results.map(r=>({squad_id:r.squad_id,participation_status:'present',placement:r.placement,total_points:'16.0000',team_kills:4,kill_points:'4',placement_points:'12',placement_multiplier:null,players:r.players.map(p=>({...p,ign:squads.find(s=>s.id===r.squad_id).eligible_players.find(x=>x.id===p.player_id).ign}))}))}; return route.fulfill({json:{data:saved}}); }
   return route.fulfill({status:404,json:{message:'Not found'}});
 });
 saved=null; await page.goto('http://localhost:5173/manage/competitions/e1/results'); await page.getByRole('button',{name:/Game 1/}).click(); await page.getByText('Squad 1',{exact:true}).waitFor();
 const s1=page.locator('.results-squad').nth(0), s2=page.locator('.results-squad').nth(1);
 await s1.locator('.results-participate input').check(); await s2.locator('.results-participate input').check();
 await s1.getByLabel('Placement').fill('1'); await s2.getByLabel('Placement').fill('1');
 await page.getByRole('button',{name:'Save results'}).click(); assert.equal(await page.getByText('Placement is already used.').count(),2); assert.equal(await page.getByText('Select at least one participating player.').count(),2);
 await s2.getByLabel('Placement').fill('2'); await s1.getByLabel('Player 1',{exact:true}).check(); await s2.getByLabel('Sub 2',{exact:true}).check();
 await s1.getByLabel('Kills').fill('4'); await page.getByRole('button',{name:'Save results'}).click(); await page.getByText('Results saved. Standings and player statistics are updated.').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true,`overflow at ${width}`); assert.deepEqual(errors,[]);
 await page.evaluate(() => window.scrollTo(0, 0));
 if(width===390 || width===1440) await page.screenshot({path:`/tmp/arewavanta-results-${width}.png`,fullPage:true});
 await page.reload(); await page.getByRole('button',{name:/Game 1/}).click(); await page.getByText('Squad 1',{exact:true}).waitFor(); assert.equal(await page.locator('.results-squad').nth(0).getByLabel('Kills').inputValue(),'4'); await page.locator('.results-squad').nth(0).getByLabel('Kills').fill('7'); assert.equal(await page.getByText('Unsaved changes').count(),1);
 console.log(`${width}px: entry, validation, save, reopen and overflow passed`); await page.close();
}
await browser.close();
