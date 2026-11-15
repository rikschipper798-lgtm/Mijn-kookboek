'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const axe=require('axe-core');
const root=path.resolve(__dirname,'..'),PORT=8783,BASE='http://127.0.0.1:'+PORT+'/_site/';
const OUT=path.join(root,'dagboek-aanpassen-testresultaten'),KEY='mijn-kookboek-voedingsdagboek';
const DATE='2026-11-15',OTHER='2026-11-14';
const recipes=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const recipe=recipes.find(r=>r.id==='klassieke-saucijzenbroodjes');
const results=[];fs.mkdirSync(OUT,{recursive:true});
const server=spawn('python3',['-m','http.server',String(PORT),'--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
let browser,page;
const seed=()=>({goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
 days:{[DATE]:[
  {id:'manual',title:'Eigen lunch',source:'manual',nutrition:{kcal:361,proteinG:12.3,carbsG:40,fatG:15,fiberG:null}},
  {id:'legacy',title:'Oud recept · 0,5 portie(s)',source:'recipe',nutrition:{kcal:333,proteinG:10,carbsG:25,fatG:20,fiberG:null}}
 ]},weekdayPresets:{},weekdayApplied:{},quickMeals:[]});
const stored=p=>p.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
async function editor(p,id){
 const row=p.locator('details[data-entry-id="'+id+'"]');
 if(!await row.evaluate(n=>n.open))await row.locator('summary').click();
 await row.locator('[data-edit]').click();await p.locator('#editEntryPanel').waitFor({state:'visible'});
}
async function save(p){await p.locator('#editEntrySave').click();await p.locator('#editEntryPanel').waitFor({state:'hidden'});}
async function context(width,data){
 const c=await browser.newContext({viewport:{width,height:900},locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block',reducedMotion:'reduce',acceptDownloads:true});
 await c.route('**/*',r=>new URL(r.request().url()).origin===new URL(BASE).origin?r.continue():r.fulfill({status:200,body:''}));
 await c.route('**/cloud-config.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.COOKBOOK_CLOUD_CONFIG={active:false};'}));
 if(data)await c.addInitScript(({key,data})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(data));},{key:KEY,data});
 const p=await c.newPage();p.setDefaultTimeout(10000);p.on('dialog',d=>d.accept());
 await p.clock.setFixedTime(new Date(DATE+'T12:00:00+01:00'));
 return {c,p};
}
(async()=>{
 try{
  for(let i=0;i<50;i++){
   try{if((await fetch(BASE+'voeding.html',{method:'HEAD'})).ok)break;}catch{}
   if(i===49)throw Error('Publicatiepakket niet bereikbaar');await new Promise(r=>setTimeout(r,100));
  }
  browser=await chromium.launch();
  for(const width of [390,1280]){
   const {c,p}=await context(width,seed());page=p;const errors=[];p.on('pageerror',e=>errors.push(e.message));
   try{
    await p.goto(BASE+'voeding.html');await p.locator('#entries > li').first().waitFor();
    await editor(p,'manual');await p.locator('#editEntryQty').fill('0.5');
    assert.equal(await p.locator('#editEntryKcal').inputValue(),'180.5');
    assert.equal(await p.locator('#editEntryFiber').inputValue(),'');
    await p.locator('#editEntryDate').fill(OTHER);await save(p);
    let data=await stored(p);assert.equal(data.days[DATE].some(e=>e.id==='manual'),false);
    assert.equal(data.days[OTHER][0].id,'manual');assert.equal(data.days[OTHER][0].nutrition.kcal,180.5);
    assert.equal(await p.locator('#selectedDate').inputValue(),OTHER);
    await p.reload();await p.locator('#selectedDate').fill(OTHER);await editor(p,'manual');
    await p.locator('#editEntryKcal').fill('999');await p.locator('#editEntryCancel').click();
    assert.equal((await stored(p)).days[OTHER][0].nutrition.kcal,180.5);

    // Ook een oudere receptregistratie kan worden aangepast, zonder herkomst te verzinnen.
    await p.locator('#selectedDate').fill(DATE);await editor(p,'legacy');
    assert.match(await p.locator('#editEntryHelp').innerText(),/niet bewaard/);
    await p.locator('#editEntryQty').fill('0.5');await save(p);
    const old=(await stored(p)).days[DATE].find(e=>e.id==='legacy');
    assert.equal(old.nutrition.kcal,166.5);assert.equal(old.recipe,undefined);

    // Nieuwe portie, variant en exacte receptversies worden opgeslagen.
    await p.goto(BASE+'voeding.html?recept='+recipe.id+'&variant=poesta');
    await p.locator('#recipePortion').filter({hasText:'2 poestabroodjes'}).waitFor();
    await p.locator('#recipeQty').fill('0.5');await p.locator('#addRecipe').click();
    data=await stored(p);const registered=data.days[DATE].find(e=>e.recipe?.variantId==='poesta');
    assert.equal(registered.nutrition.kcal,355);assert.equal(registered.recipe.version,recipe.variants.find(v=>v.id==='poesta').version);
    assert.equal(registered.recipe.baseVersion,recipe.version);assert.equal(registered.portion.label,'2 poestabroodjes');

    // Verander het huidige kookboek: de eerdere registratie gebruikt haar eigen waarden.
    const newer=JSON.parse(JSON.stringify(recipes)),changed=newer.find(r=>r.id===recipe.id).variants.find(v=>v.id==='poesta');
    changed.nutrition.kcal=9999;changed.nutrition.portionLabel='een gewijzigde portie';changed.version++;
    await c.route('**/recepten.json',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(newer)}));
    await p.reload();await editor(p,registered.id);
    assert.match(await p.locator('#editEntryPortion').innerText(),/2 poestabroodjes/);
    assert.equal(await p.locator('#editEntryKcal').getAttribute('readonly'),'');
    await p.locator('#editEntryQty').fill('1');assert.equal(await p.locator('#editEntryKcal').inputValue(),'710');
    await p.locator('#editEntryDate').fill(OTHER);
    await p.addScriptTag({content:axe.source});
    const violations=await p.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
    assert.deepEqual(violations,[]);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Horizontale overloop');
    await p.locator('#editEntryPanel').screenshot({path:path.join(OUT,'aanpassen-'+width+'.png')});
    await save(p);data=await stored(p);const edited=data.days[OTHER].find(e=>e.id===registered.id);
    assert.equal(edited.nutrition.kcal,710);assert.deepEqual(edited.recipe,registered.recipe);
    assert.equal(data.days[DATE].some(e=>e.id===registered.id),false);
    await p.reload();await p.locator('#selectedDate').fill(OTHER);
    assert.equal((await stored(p)).days[OTHER].find(e=>e.id===registered.id).nutrition.kcal,710);

    // Export en import behouden ook de nieuwe portie- en herkomstgegevens.
    await p.locator('#settingsMenu > summary').click();
    const downloadPromise=p.waitForEvent('download');await p.locator('#export').click();
    const download=await downloadPromise,payload=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.deepEqual(payload.data.days[OTHER].find(e=>e.id===registered.id),edited);
    const restored=await context(width,null);
    try{
     await restored.p.goto(BASE+'voeding.html');
     await restored.p.locator('#importFile').setInputFiles({name:'dagboek.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
     await restored.p.locator('#status').filter({hasText:'Voedingsdagboek hersteld.'}).waitFor();
     assert.deepEqual(await stored(restored.p),payload.data);
    }finally{await restored.c.close();}
    assert.deepEqual(errors,[]);results.push({width,passed:true,checks:['handmatige correctie','datum verplaatsen','oude registraties','receptvariant','historische waarden','herladen','export en import','toegankelijkheid']});
    console.log('GESLAAGD '+width+'px: registraties aanpassen, historie behouden en toegankelijk formulier.');
   }finally{await c.close();page=null;}
  }
 }catch(error){
  results.push({passed:false,error:error.stack});console.error(error);process.exitCode=1;
  if(page&&!page.isClosed())await page.screenshot({path:path.join(OUT,'fout.png'),fullPage:true}).catch(()=>{});
 }finally{
  if(browser)await browser.close();server.kill();fs.writeFileSync(path.join(OUT,'resultaten.json'),JSON.stringify(results,null,2));
 }
})().catch(error=>{console.error(error);process.exitCode=1;server.kill();});
