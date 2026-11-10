'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const PORT=8770,BASE='http://127.0.0.1:'+PORT,ART='sync-testresultaten';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const copy=o=>JSON.parse(JSON.stringify(o));
const date='2026-11-10';
const original=()=>({
 goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
 days:{[date]:[{id:'start',title:'Basisontbijt',source:'manual',
  nutrition:{kcal:250,proteinG:13,carbsG:36,fatG:7,fiberG:4}}]},
 weekdayPresets:{},weekdayApplied:{}
});
const store=new Map(),unreachable=new Set(),results=[];
fs.mkdirSync(ART,{recursive:true});
const server=spawn('python3',['-m','http.server',String(PORT),'--bind','127.0.0.1'],{stdio:'ignore'});
let browser;
function seed(account){store.set(account,{diary:original(),revision:1});}
function fakeRpc(message){
 const {table,device,account,mode,body,filters={}}=message;
 if(unreachable.has(device))return {data:null,error:{code:'NETWORK',message:'Fictieve netwerkuitval'}};
 if(filters.user_id&&filters.user_id!==account)return {data:null,error:{code:'RLS',message:'Geen toegang'}};
 if(table==='nutrition_diary_history')return {data:[],error:null};
 if(table!=='nutrition_diaries')return {data:null,error:{code:'TABLE',message:'Onbekende tabel'}};
 const row=store.get(account);
 if(mode==='select')return {data:row?copy(row):null,error:null};
 if(mode==='insert'){
  if(row)return {data:null,error:{code:'23505',message:'Dossier bestaat al'}};
  if(body.user_id!==account)return {data:null,error:{code:'RLS',message:'Geen toegang'}};
  store.set(account,{diary:copy(body.diary),revision:body.revision});
  return {data:{revision:body.revision},error:null};
 }
 if(mode==='update'){
  if(!row||row.revision!==filters.revision)return {data:null,error:null};
  store.set(account,{diary:copy(body.diary),revision:body.revision});
  return {data:{revision:body.revision},error:null};
 }
 throw Error('Onbekende opdracht '+mode);
}
async function newDevice(account,device,options={}){
 const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1366,height:850},
  timezoneId:'Europe/Amsterdam',locale:'nl-NL',serviceWorkers:'block',acceptDownloads:true});
 await context.exposeBinding('__fakeCloud',(_source,message)=>fakeRpc(message));
 await context.route('**/cloud-config.js',route=>route.fulfill({
  status:200,contentType:'application/javascript',
  body:'window.COOKBOOK_CLOUD_CONFIG={active:true,url:"https://fake-sync.supabase.co",publishableKey:"sb_publishable_sync_browser_test_01234567890123"};'
 }));
 await context.addInitScript(({account,device})=>{
  const identity={id:account,email:account+'@example.invalid'};
  window.supabase={createClient(){
   return {
    auth:{
     getSession:async()=>({data:{session:{user:identity}},error:null}),
     onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
     signInWithOtp:async()=>({data:{},error:null}),
     signOut:async()=>({error:null})
    },
    from(table){
     const q={mode:'select',body:null,filters:{},
      select(){return this;},
      eq(key,value){this.filters[key]=value;return this;},
      insert(body){this.mode='insert';this.body=body;return this;},
      update(body){this.mode='update';this.body=body;return this;},
      async maybeSingle(){
       return window.__fakeCloud({table,device,account,mode:this.mode,body:this.body,filters:this.filters});
      },
      async single(){return this.maybeSingle();},
      order(){return this;},
      async limit(){return {data:[],error:null};}
     };
     return q;
    }
   };
  }};
 },{account,device});
 const page=await context.newPage();
 if(options.clock)await page.clock.install();
 await page.goto(BASE+'/voeding.html',{waitUntil:'domcontentloaded'});
 await page.locator('#diaryContent').waitFor({state:'visible',timeout:15000});
 await page.locator('#selectedDate').fill(date);
 return {context,page,device,account,async close(){await context.close()}};
}
async function awaitRemote(account,predicate,description){
 for(let i=0;i<95;i++){
  const row=store.get(account);
  if(row&&predicate(row))return;
  await sleep(100);
 }
 throw Error('Cloud wachtte te lang op '+description+': '+JSON.stringify(store.get(account)));
}
async function awaitBrowser(page,predicate,description){
 await page.waitForFunction(predicate,null,{timeout:12000}).catch(e=>{
  throw Error('Browser wachtte te lang op '+description+': '+e.message);
 });
}
async function addMeal(page,title,kcal){
 await page.locator('#addMealButton').click();
 await page.locator('#mealManualChoice').click();
 await page.locator('#manualName').fill(title);
 await page.locator('#manualKcal').fill(String(kcal));
 await page.locator('#manualForm button[type=submit]').click();
}
async function forceRefresh(page){await page.evaluate(()=>window.dispatchEvent(new Event('online')));}
async function run(name,fn){
 const begin=Date.now();
 try{const detail=await fn();results.push({name,ok:true,detail,elapsedMs:Date.now()-begin});
  console.log('GESLAAGD | '+name+' | '+JSON.stringify(detail||{}));
 }catch(e){results.push({name,ok:false,error:e.stack,elapsedMs:Date.now()-begin});
  console.log('MISLUKT | '+name+' | '+e.stack);}
}
async function goReady(){
 for(let i=0;i<80;i++){
  try{const r=await fetch(BASE+'/voeding.html');if(r.ok)return;}catch(e){}
  await sleep(150);
 }
 throw Error('Lokale server start niet');
}
(async()=>{
 try{
  await goReady();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});

  await run('1. Twee apparaten: maaltijden en doelen verschijnen na verversen op beide',async()=>{
   const account='beide-richtingen';seed(account);
   const a=await newDevice(account,'telefoon',{mobile:true});
   const b=await newDevice(account,'laptop');
   try{
    await addMeal(a.page,'Avondeten op telefoon',700);
    await awaitRemote(account,r=>r.revision===2,'toevoeging telefoon');
    await forceRefresh(b.page);
    await awaitBrowser(b.page,()=>document.querySelector('#entries')?.textContent.includes('Avondeten op telefoon'),'telefoonmaaltijd op laptop');
    await b.page.locator('#settingsMenu>summary').click();
    await b.page.locator('#editGoals>summary').click();
    await b.page.locator('#goalKcal').fill('2450');
    await b.page.locator('#goalsForm button[type=submit]').click();
    await sleep(1150);
    const debug=await b.page.evaluate(()=>({
     status:document.querySelector('#status')?.textContent,
     cloud:document.querySelector('#cloudStatus')?.textContent,
     account:document.querySelector('#accountStateLabel')?.textContent,
     goalKcal:document.querySelector('#goalKcal')?.value,
     pending:Object.keys(localStorage).filter(k=>k.startsWith('mijn-kookboek-cloud-herstel-v1:')).length
    }));
    console.log('DIAGNOSTIEK DOELEN '+JSON.stringify(debug)+' server '+JSON.stringify(store.get(account)));
    await awaitRemote(account,r=>r.revision===3&&r.diary.goals.kcal===2450,'gewijzigd caloriedoel');
    await forceRefresh(a.page);
    await awaitBrowser(a.page,()=>document.querySelector('#calories')?.textContent.includes('2.450 kcal'),'nieuw caloriedoel op telefoon');
    return {revision:3,meals:store.get(account).diary.days[date].length,goal:2450};
   }finally{await a.close();await b.close();}
  });

  await run('2. Gelijktijdig bewerken: verouderd apparaat overschrijft de cloud niet',async()=>{
   const account='gelijktijdig';seed(account);
   const a=await newDevice(account,'a-gelijktijdig');
   const b=await newDevice(account,'b-gelijktijdig',{mobile:true});
   try{
    await addMeal(a.page,'Toevoeging eerste apparaat',510);
    await awaitRemote(account,r=>r.revision===2,'wijziging apparaat A');
    await addMeal(b.page,'Toevoeging tweede apparaat',680);
    await awaitBrowser(b.page,()=>document.querySelector('#accountStateLabel')?.textContent.includes('Synchronisatie vraagt aandacht'),'conflictmelding');
    assert.equal(store.get(account).revision,2);
    assert.equal(store.get(account).diary.days[date].some(e=>e.title==='Toevoeging tweede apparaat'),false);
    const recovered=await b.page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('mijn-kookboek-cloud-herstel-v1:')).map(k=>JSON.parse(localStorage.getItem(k))));
    assert.equal(recovered.length,1);
    assert.ok(recovered[0].diary.days[date].some(e=>e.title==='Toevoeging tweede apparaat'));
    await b.page.reload({waitUntil:'domcontentloaded'});
    await b.page.locator('#diaryContent').waitFor({state:'visible'});
    assert.equal(await b.page.locator('#accountStateLabel').textContent(),'Synchronisatie vraagt aandacht');
    await b.page.evaluate(()=>window.confirm=()=>false);
    await b.page.locator('#openAccountTools').click();
    await b.page.locator('#cloudRefresh').click();
    assert.equal(store.get(account).revision,2);
    const stillSaved=await b.page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('mijn-kookboek-cloud-herstel-v1:')));
    assert.equal(stillSaved,true);
    await b.page.evaluate(()=>window.confirm=()=>true);
    await b.page.locator('#cloudRefresh').click();
    await awaitBrowser(b.page,()=>document.querySelector('#accountStateLabel')?.textContent==='Dagboek gesynchroniseerd','bewuste cloudversie na conflict');
    assert.equal(await b.page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('mijn-kookboek-cloud-herstel-v1:'))),false);
    return {revision:2,localRecoveryPreserved:true,explicitConfirmationRequired:true};
   }finally{await a.close();await b.close();}
  });

  await run('3. Netwerkuitval: herstelkopie blijft staan en synchroniseert na verbinding',async()=>{
   const account='offline-retry';seed(account);
   const a=await newDevice(account,'a-offline');
   const b=await newDevice(account,'b-offline',{mobile:true});
   try{
    unreachable.add('b-offline');
    await addMeal(b.page,'Tijdens offline',380);
    await sleep(950);
    assert.equal(store.get(account).revision,1,'Offline wijziging is toch geüpload');
    const saved=await b.page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('mijn-kookboek-cloud-herstel-v1:')).length);
    assert.equal(saved,1);
    unreachable.delete('b-offline');
    await forceRefresh(b.page);
    await awaitRemote(account,r=>r.revision===2,'offline-herstel');
    await forceRefresh(a.page);
    await awaitBrowser(a.page,()=>document.querySelector('#entries')?.textContent.includes('Tijdens offline'),'offline-maaltijd op ander apparaat');
    return {recovered:true,revision:2};
   }finally{unreachable.delete('b-offline');await a.close();await b.close();}
  });

  await run('4. Accountisolatie: twee gebruikers mengen nooit gegevens',async()=>{
   seed('eigen-A');seed('eigen-B');
   const a=await newDevice('eigen-A','apparaat-A');
   const b=await newDevice('eigen-B','apparaat-B');
   try{
    await addMeal(a.page,'Alleen voor A',470);
    await awaitRemote('eigen-A',r=>r.revision===2,'A wijziging');
    await forceRefresh(b.page);
    assert.equal(store.get('eigen-B').revision,1);
    assert.equal((await b.page.locator('#entries').textContent()).includes('Alleen voor A'),false);
    return {accountsIsolated:true};
   }finally{await a.close();await b.close();}
  });

  await run('5. Twee tabbladen: hetzelfde lokale herstelbestand wordt niet overschreven',async()=>{
   const account='zelfde-browser';seed(account);
   const a=await newDevice(account,'zelfde-context');
   const second=await a.context.newPage();
   try{
    await second.goto(BASE+'/voeding.html',{waitUntil:'domcontentloaded'});
    await second.locator('#diaryContent').waitFor({state:'visible'});
    await second.locator('#selectedDate').fill(date);
    await addMeal(a.page,'In eerste tabblad',400);
    await addMeal(second,'In tweede tabblad',650);
    const message=await second.locator('#status').textContent();
    assert.match(message,/niet opgeslagen|ander tabblad/i);
    assert.equal(store.get(account).diary.days[date].some(e=>e.title==='In tweede tabblad'),false);
    await awaitRemote(account,r=>r.revision===2,'eerste tabblad');
    return {duplicatePrevented:true,secondStatus:message};
   }finally{await a.close();}
  });

  await run('6. Actieve tweede browser ziet nieuwe cloudgegevens automatisch',async()=>{
   const account='automatische-update';seed(account);
   const a=await newDevice(account,'auto-eerste');
   const b=await newDevice(account,'auto-tweede',{clock:true});
   try{
    await addMeal(a.page,'Automatisch zichtbaar',360);
    await awaitRemote(account,r=>r.revision===2,'nieuwe maaltijd op eerste apparaat');
    await b.page.clock.fastForward(62000);
    await awaitBrowser(b.page,()=>document.querySelector('#entries')?.textContent.includes('Automatisch zichtbaar'),'automatische verversing');
    return {automaticRefresh:true};
   }finally{await a.close();await b.close();}
  });
 }catch(e){console.log('INFRASTRUCTUURFOUT '+e.stack);process.exitCode=2;}
 finally{
  if(browser)await browser.close();
  server.kill();
  fs.writeFileSync(ART+'/resultaten.json',JSON.stringify(results,null,2));
  console.log('SYNCHRONISATIETEST '+results.filter(x=>x.ok).length+'/'+results.length+' geslaagd');
  if(results.length<6||results.some(x=>!x.ok))process.exitCode=1;
 }
})().catch(e=>{console.log(e.stack);process.exitCode=2;server.kill();});
