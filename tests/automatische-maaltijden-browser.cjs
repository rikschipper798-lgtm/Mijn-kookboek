'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const PORT=8771,BASE='http://127.0.0.1:'+PORT,ART='automatische-maaltijden-testresultaten';
const DATE='2026-11-10',KEY='mijn-kookboek-voedingsdagboek';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const results=[];
fs.mkdirSync(ART,{recursive:true});
const server=spawn('python3',['-m','http.server',String(PORT),'--bind','127.0.0.1'],{stdio:'ignore'});
let browser;
const nutrition=(kcal,proteinG,carbsG,fatG,fiberG)=>({kcal,proteinG,carbsG,fatG,fiberG});
const preset=(title,n)=>({title,enabled:true,startDate:'2026-01-01',nutrition:n});
const base=()=>({
 goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
 days:{},
 weekdayPresets:{
  ontbijt:preset('Kwark met fruit',nutrition(350,28,43,6,6)),
  lunch:preset('Brood met kipfilet',nutrition(510,32,57,14,7))
 },
 weekdayApplied:{}
});
const copy=data=>JSON.parse(JSON.stringify(data));
const todayRows=data=>(data.days[DATE]||[]);
async function device(data=base(),cloud=false){
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
 await context.route('**/cloud-config.js',route=>route.fulfill({
  status:200,contentType:'application/javascript',
  body:cloud?
   'window.COOKBOOK_CLOUD_CONFIG={active:true,url:"https://test-automated.supabase.co",publishableKey:"sb_publishable_test_automated_0123456789012345"};':
   'window.COOKBOOK_CLOUD_CONFIG={active:false};'
 }));
 if(!cloud)await context.addInitScript(({data,key})=>{
  if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify(data));
 },{data,key:KEY});
 else await context.addInitScript(data=>{
  const copy=x=>JSON.parse(JSON.stringify(x));
  window.__mockCloud={row:{diary:copy(data),revision:1},updates:0};
  window.supabase={createClient(){
   return {
    auth:{
     async getSession(){return {data:{session:{user:{id:'fixture-user',email:'test@example.invalid'}}},error:null};},
     onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};}
    },
    from(table){
     if(table!=='nutrition_diaries')throw Error('Unexpected mock DB table');
     let mode='read',body,filters={};
     const query={
      select(){return this;},eq(k,v){filters[k]=v;return this;},
      update(v){body=v;mode='update';return this;},
      insert(v){body=v;mode='insert';return this;},
      async maybeSingle(){
       const db=window.__mockCloud;
       if(mode==='read')return {data:copy(db.row),error:null};
       if(mode==='update'){
        if(filters.revision!==db.row.revision)return {data:null,error:null};
        db.row={diary:copy(body.diary),revision:body.revision};db.updates++;
        return {data:{revision:body.revision},error:null};
       }
       db.row={diary:copy(body.diary),revision:body.revision};db.updates++;
       return {data:{revision:body.revision},error:null};
      },
      async single(){return this.maybeSingle();}
     };
     return query;
    }
   };
  }};
 },data);
 const page=await context.newPage();
 await page.goto(BASE+'/voeding.html',{waitUntil:'domcontentloaded'});
 await page.locator('#diaryContent').waitFor({state:'visible'});
 if((await page.locator('#selectedDate').inputValue())!==DATE)await page.locator('#selectedDate').fill(DATE);
 return {context,page,async close(){await context.close();}};
}
async function readState(page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);}
async function waitCloud(page,test){await page.waitForFunction(test,null,{timeout:10000});}
async function run(name,action){
 const started=Date.now();
 try{const detail=await action();results.push({name,passed:true,detail,ms:Date.now()-started});
  console.log('GESLAAGD | '+name+' | '+JSON.stringify(detail||{}));
 }catch(error){results.push({name,passed:false,error:error.stack,ms:Date.now()-started});
  console.log('MISLUKT | '+name+' | '+error.stack);}
}
(async()=>{
 try{
  for(let tries=0;tries<60;tries++){
   try{if((await fetch(BASE+'/voeding.html')).ok)break;}catch(error){}
   if(tries===59)throw Error('Testwebsite niet bereikbaar');await sleep(150);
  }
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});

  await run('1. Nieuw automatisch ontbijt en lunch zijn voorlopig en tellen niet mee',async()=>{
   const d=await device();try{
    const p=d.page;
    assert.equal(await p.locator('#entries .entry-disclosure').count(),2);
    assert.equal(await p.locator('#entries .entry-disclosure[open]').count(),2);
    assert.equal(await p.locator('[data-confirm]').count(),2);
    assert.match(await p.locator('#pendingSummary').textContent(),/2 automatisch ingevulde maaltijden/);
    assert.match(await p.locator('#calories').textContent(),/^\s*0\s/);
    assert.match(await p.locator('#calorieNote').textContent(),/wachten op je bevestiging/);
    const state=await readState(p);
    assert.ok(todayRows(state).every(x=>x.source==='preset'&&x.confirmed===false));
    assert.match(await p.locator('#weekOverview').textContent(),/Nog te bevestigen/);
    await p.screenshot({path:ART+'/voorlopige-maaltijden.png',fullPage:true});
    return {pending:2,countedCalories:0};
   }finally{await d.close();}
  });

  await run('2. Bevestigen telt precies een maaltijd mee en overleeft herladen',async()=>{
   const d=await device();try{
    const p=d.page;
    await p.locator('[data-confirm]').first().click();
    assert.equal(await p.locator('[data-confirm]').count(),1);
    assert.match(await p.locator('#calories').textContent(),/350\s/);
    assert.match(await p.locator('#pendingSummary').textContent(),/1 automatisch ingevulde maaltijd/);
    const saved=await readState(p);
    assert.equal(todayRows(saved).filter(x=>x.confirmed===true).length,1);
    await p.reload({waitUntil:'domcontentloaded'});
    assert.equal(await p.locator('[data-confirm]').count(),1);
    assert.match(await p.locator('#calories').textContent(),/350\s/);
    return {confirmed:1,calories:350};
   }finally{await d.close();}
  });

  await run('3. Aanpassen bevestigt en bewaart de feitelijke dagregistratie',async()=>{
   const d=await device();try{
    const p=d.page;
    await p.locator('[data-edit]').first().click();
    await p.locator('#editEntryPanel').waitFor({state:'visible'});
    await p.locator('#editEntryName').fill('Kwark met extra havermout');
    await p.locator('#editEntryKcal').fill('475');
    await p.locator('#editEntryProtein').fill('35.5');
    await p.locator('#editEntryFiber').fill('9.5');
    await p.locator('#editEntryForm button[type=submit]').click();
    await p.locator('#editEntryPanel').waitFor({state:'hidden'});
    assert.equal(await p.locator('[data-confirm]').count(),1);
    assert.match(await p.locator('#calories').textContent(),/475\s/);
    const item=todayRows(await readState(p)).find(x=>x.title==='Kwark met extra havermout');
    assert.ok(item,'Gecorrigeerde maaltijd ontbreekt');
    assert.equal(item.confirmed,true);
    assert.equal(item.adjusted,true);
    assert.equal(item.nutrition.kcal,475);
    assert.equal(item.nutrition.proteinG,35.5);
    assert.equal(item.presetSlot,'ontbijt');
    await p.reload({waitUntil:'domcontentloaded'});
    assert.equal(todayRows(await readState(p)).find(x=>x.id===item.id).nutrition.kcal,475);
    await p.screenshot({path:ART+'/aangepaste-maaltijd.png'});
    return {corrected:true,confirmed:true,protein:35.5};
   }finally{await d.close();}
  });

  await run('4. Niet gegeten verwijdert de aanname zonder automatische heraanmaak',async()=>{
   const d=await device();try{
    const p=d.page;
    await p.locator('button[data-remove]').first().click();
    assert.equal(await p.locator('[data-confirm]').count(),1);
    const state=await readState(p);
    assert.equal(todayRows(state).length,1);
    assert.equal(state.weekdayApplied[DATE].length,2);
    await p.reload({waitUntil:'domcontentloaded'});
    assert.equal(await p.locator('#entries .entry-disclosure').count(),1);
    assert.match(await p.locator('#calories').textContent(),/^\s*0\s/);
    return {removed:true,notRecreated:true};
   }finally{await d.close();}
  });

  await run('5. Oudere automatische registraties behouden hun bestaande dagtotaal',async()=>{
   const state=base();
   state.days[DATE]=[{id:'oud',source:'preset',title:'Standaard ontbijt: Historisch ontbijt',
    nutrition:nutrition(420,22,48,13,5)}];
   state.weekdayApplied[DATE]=['ontbijt','lunch'];
   const d=await device(state);try{
    const p=d.page;
    assert.match(await p.locator('#calories').textContent(),/420\s/);
    assert.equal(await p.locator('[data-confirm]').count(),0);
    const loaded=await readState(p);
    assert.equal(todayRows(loaded).length,1);
    await p.locator('#export').click({force:true}).catch(()=>{});
    return {legacyCounted:true,confirmationNotRequired:true};
   }finally{await d.close();}
  });

  await run('6. Wijziging vaste standaard overschrijft gecorrigeerde maaltijd niet',async()=>{
   const d=await device();try{
    const p=d.page;
    await p.locator('[data-edit]').first().click();
    await p.locator('#editEntryName').fill('Mijn echt gegeten ontbijt');
    await p.locator('#editEntryKcal').fill('495');
    await p.locator('#editEntryForm button[type=submit]').click();
    await p.evaluate(()=>window.confirm=()=>true);
    const newPresets=base().weekdayPresets;
    newPresets.ontbijt=preset('Ander vast ontbijt',nutrition(999,99,99,99,99));
    await p.locator('#importPresetFile').setInputFiles({
     name:'vaste-maaltijden.json',mimeType:'application/json',
     buffer:Buffer.from(JSON.stringify({app:'mijn-kookboek-vaste-maaltijden',version:1,weekdayPresets:newPresets}))
    });
    await p.waitForTimeout(140);
    const state=await readState(p);
    const breakfast=todayRows(state).find(x=>x.presetSlot==='ontbijt');
    assert.equal(breakfast.title,'Mijn echt gegeten ontbijt');
    assert.equal(breakfast.nutrition.kcal,495);
    assert.equal(breakfast.confirmed,true);
    assert.equal(state.weekdayPresets.ontbijt.nutrition.kcal,999);
    return {editedMealPreserved:true,newPresetSaved:true};
   }finally{await d.close();}
  });

  await run('7. Bevestigde automatische maaltijd wordt via normale cloudsync opgeslagen',async()=>{
   const state=base();
   state.days[DATE]=[{id:'cloud-ontbijt',source:'preset',presetSlot:'ontbijt',confirmed:false,
     title:'Standaard ontbijt: Kwark met fruit',nutrition:nutrition(350,28,43,6,6)}];
   state.weekdayApplied[DATE]=['ontbijt','lunch'];
   const d=await device(state,true);try{
    const p=d.page;
    await p.locator('[data-confirm]').first().click();
    await waitCloud(p,()=>window.__mockCloud.row.diary.days['2026-11-10'][0].confirmed===true&&window.__mockCloud.row.revision>=2);
    const cloud=await p.evaluate(()=>window.__mockCloud);
    assert.equal(cloud.row.diary.days[DATE][0].confirmed,true);
    assert.ok(cloud.updates>0);
    assert.match(await p.locator('#accountStateLabel').textContent(),/gesynchroniseerd|wachten/i);
    return {confirmedInCloud:true,revision:cloud.row.revision};
   }finally{await d.close();}
  });

 }catch(error){console.log('TESTINFRASTRUCTUUR '+error.stack);process.exitCode=2;}
 finally{
  if(browser)await browser.close();
  server.kill();
  fs.writeFileSync(ART+'/resultaten.json',JSON.stringify(results,null,2));
  console.log('AUTOMATISCHE MAALTIJDEN '+results.filter(x=>x.passed).length+'/'+results.length+' geslaagd');
  if(results.length!==7||results.some(x=>!x.passed))process.exitCode=1;
 }
})().catch(error=>{console.log(error.stack);process.exitCode=2;server.kill();});
