'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

const BASE='http://127.0.0.1:8767';
const output='herstel-testresultaten';
const tests=[];
fs.mkdirSync(output,{recursive:true});
const server=spawn('python3',['-m','http.server','8767','--bind','127.0.0.1'],{stdio:'ignore'});
let browser;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clone=data=>JSON.parse(JSON.stringify(data));
const mkDiary=(title,kcal)=>({
 goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
 days:{'2026-11-07':[{id:'demo-'+kcal,source:'manual',title,
  nutrition:{kcal,proteinG:20,carbsG:44,fatG:12,fiberG:5}}]},
 weekdayPresets:{},weekdayApplied:{},
 quickMeals:[{id:'quick-'+kcal,title:'Standaard '+title,
  nutrition:{kcal,proteinG:20,carbsG:44,fatG:12,fiberG:5}}]
});
const seed=mkDiary('Oorspronkelijke testmaaltijd',410);
const target=mkDiary('Herstelde testmaaltijd',720);
const KEY='mijn-kookboek-voedingsdagboek';

async function run(name,fn){
 const started=Date.now();
 try{
  const detail=await fn();
  tests.push({name,ok:true,detail,durationMs:Date.now()-started});
  console.log('GESLAAGD | '+name+' | '+JSON.stringify(detail||{}));
 }catch(error){
  tests.push({name,ok:false,error:error.stack,durationMs:Date.now()-started});
  console.log('MISLUKT | '+name+' | '+error.stack);
 }
}
async function context(local=true){
 const c=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL',timezoneId:'Europe/Amsterdam',acceptDownloads:true,serviceWorkers:'block'});
 const p=await c.newPage();
 await p.route('**/cloud-config.js',route=>route.fulfill({status:200,contentType:'application/javascript',
  body:local?'window.COOKBOOK_CLOUD_CONFIG={active:false};':
  'window.COOKBOOK_CLOUD_CONFIG={active:true,url:"https://test-account.supabase.co",publishableKey:"sb_publishable_browser_test_0123456789012345"};'
 }));
 if(local)await p.addInitScript(data=>{
  const key='mijn-kookboek-voedingsdagboek';
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(data));
 },seed);
 return {c,p};
}
const open=async p=>p.goto(BASE+'/voeding.html',{waitUntil:'domcontentloaded'});
const waitFor=async(p,predicate)=>p.waitForFunction(predicate,null,{timeout:10000});
const importFile=(p,obj)=>p.locator('#importFile').setInputFiles({
 name:'test-dagboek.json',mimeType:'application/json',
 buffer:Buffer.from(typeof obj==='string'?obj:JSON.stringify(obj))
});
const current=async p=>p.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
const payload=data=>({app:'mijn-kookboek-voedingsdagboek',version:1,exportedAt:new Date().toISOString(),data});
async function showSettings(p){await p.locator('#settingsMenu>summary').click();}
function cloudStub(){
 const mk=(title,kcal)=>({
  goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
  days:{'2026-11-07':[{id:'demo-'+kcal,source:'manual',title,
   nutrition:{kcal,proteinG:20,carbsG:44,fatG:12,fiberG:5}}]},
  weekdayPresets:{},weekdayApplied:{}
 });
 const initial=mk('Actuele cloudmaaltijd',920);
 const previous=mk('Vorige cloudmaaltijd',530);
 // Function runs as init script in a real browser. Keep all state local.
 window.__testCloud={row:{diary:initial,revision:2},history:[
  {revision:1,saved_at:new Date(Date.now()-86400000).toISOString(),diary:previous}
 ]};
 window.supabase={createClient(){
  const db=window.__testCloud;
  return {
   auth:{
    async getSession(){return {data:{session:{user:{id:'test-user',email:'test@example.invalid'}}},error:null}},
    onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};}
   },
   from(table){
    let mode='select',body=null,filters={};
    return {
     select(){return this;},
     eq(key,value){filters[key]=value;return this;},
     order(){return this;},
     update(value){mode='update';body=value;return this;},
     insert(value){mode='insert';body=value;return this;},
     async limit(n){
      if(table!=='nutrition_diary_history')throw Error('Unexpected table');
      return {data:db.history.slice().reverse().slice(0,n),error:null};
     },
     async maybeSingle(){
      if(table!=='nutrition_diaries')throw Error('Unexpected table');
      if(mode==='select')return {data:{diary:JSON.parse(JSON.stringify(db.row.diary)),revision:db.row.revision},error:null};
      if(filters.revision!==db.row.revision)return {data:null,error:null};
      db.history.push({revision:db.row.revision,diary:JSON.parse(JSON.stringify(db.row.diary)),saved_at:new Date().toISOString()});
      db.row={diary:JSON.parse(JSON.stringify(body.diary)),revision:body.revision};
      return {data:{revision:body.revision},error:null};
     },
     async single(){return this.maybeSingle();}
    };
   }
  };
 }};
}

(async()=>{
 try{
  for(let i=0;i<60;i++){
   try{const r=await fetch(BASE+'/voeding.html',{method:'HEAD'});if(r.ok)break;}catch(e){}
   if(i===59)throw Error('Testserver start niet');
   await sleep(150);
  }
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  await run('1. Gewone JSON-back-up exporteren en na wijziging volledig herstellen',async()=>{
   const {c,p}=await context();
   try{
    await open(p);await showSettings(p);
    const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#export').click()]);
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.deepEqual(exported.data,seed);
    await importFile(p,payload(target));
    await p.waitForTimeout(100);
    assert.deepEqual(await current(p),seed,'Zonder bevestiging mag de oude inhoud niet verdwijnen');
    return {exportMatch:true};
   }finally{await c.close();}
  });

  await run('2. Bevestigd JSON-herstel vervangt exact het dagboek en wordt opnieuw geladen',async()=>{
   const {c,p}=await context();
   try{
    await open(p);
    await p.evaluate(()=>window.confirm=()=>true);
    await importFile(p,payload(target));
    await waitFor(p,()=>document.querySelector('#entries')!==null&&document.querySelector('#status').textContent.includes('hersteld'));
    assert.deepEqual(await current(p),target);
    await p.reload({waitUntil:'domcontentloaded'});
    assert.deepEqual(await current(p),target);
    await p.screenshot({path:output+'/hersteld-json.png'});
    return {restored:true,readAfterReload:true};
   }finally{await c.close();}
  });

  await run('3. Annuleren of ongeldig importbestand bewaart de bestaande gegevens',async()=>{
   const {c,p}=await context();
   try{
    await open(p);
    await p.evaluate(()=>window.confirm=()=>false);
    await importFile(p,payload(target));
    await sleep(100);
    assert.deepEqual(await current(p),seed);
    assert.deepEqual(await importFile(p,'geen json'),undefined);
    await waitFor(p,()=>document.querySelector('#status').textContent.includes('Importeren mislukt'));
    assert.deepEqual(await current(p),seed);
    await importFile(p,{app:'mijn-kookboek-voedingsdagboek',version:1,data:{goals:{},days:{}}});
    await sleep(100);
    assert.deepEqual(await current(p),seed);
    return {cancel:true,invalidJson:true,invalidStructure:true};
   }finally{await c.close();}
  });

  await run('4. Versleutelde export en herstel: verkeerde wachtzin mag niet overschrijven',async()=>{
   const {c,p}=await context();
   try{
    await open(p);await showSettings(p);
    await p.locator('#secureBackupOptions>summary').click();
    await p.locator('#backupPass').fill('Een veilige testwachtzin 2026');
    await p.locator('#backupPassConfirm').fill('Een veilige testwachtzin 2026');
    const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#backupEncrypted').click()]);
    const encrypted=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(encrypted.app,'mijn-kookboek-versleuteld-dagboek');
    assert.equal(JSON.stringify(encrypted).includes('Oorspronkelijke testmaaltijd'),false);
    await p.evaluate(()=>window.confirm=()=>true);
    await importFile(p,payload(target));
    await waitFor(p,()=>document.querySelector('#status').textContent.includes('Voedingsdagboek hersteld'));
    assert.deepEqual(await current(p),target);
    await importFile(p,encrypted);
    await waitFor(p,()=>!document.querySelector('#backupDecryptBox').hidden);
    await p.locator('#backupDecryptPass').fill('Verkeerd wachtwoord 2026');
    await p.locator('#backupDecrypt').click();
    await waitFor(p,()=>document.querySelector('#status').textContent.includes('Ontsleutelen/importeren mislukt'));
    assert.deepEqual(await current(p),target,'Foute wachtzin overschreef het dagboek');
    await p.locator('#backupDecryptPass').fill('Een veilige testwachtzin 2026');
    await p.locator('#backupDecrypt').click();
    await waitFor(p,()=>document.querySelector('#status').textContent.includes('Voedingsdagboek hersteld'));
    assert.deepEqual(await current(p),seed,'Goede wachtzin moet exact het originele dagboek herstellen');
    assert.equal(await p.locator('#backupDecryptBox').isHidden(),true);
    await p.screenshot({path:output+'/herstel-versleuteld.png'});
    return {wrongPasswordRejected:true,correctPasswordRestores:true};
   }finally{await c.close();}
  });

  await run('5. Oudere cloudversie: annuleren behoudt actuele gegevens, bevestigen maakt herstelversie',async()=>{
   const {c,p}=await context(false);
   try{
    await p.addInitScript(cloudStub);
    await open(p);
    await p.locator('#selectedDate').fill('2026-11-07');
    await p.locator('#entries .entry-disclosure').first().waitFor();
    await p.locator('#openAccountTools').click();
    await p.locator('#cloudHistorySection>summary').click();
    await p.locator('#cloudHistoryLoad').click();
    await p.locator('#cloudHistorySelect').waitFor({state:'visible'});
    await p.locator('#cloudHistorySelect').selectOption('1');
    await p.evaluate(()=>window.confirm=()=>false);
    await p.locator('#cloudHistoryRestore').click();
    let state=await p.evaluate(()=>window.__testCloud.row);
    assert.equal(state.revision,2);
    assert.equal(state.diary.days['2026-11-07'][0].nutrition.kcal,920);
    await p.evaluate(()=>window.confirm=()=>true);
    await p.locator('#cloudHistoryRestore').click();
    await waitFor(p,()=>window.__testCloud.row.revision===3);
    state=await p.evaluate(()=>window.__testCloud);
    assert.equal(state.row.diary.days['2026-11-07'][0].nutrition.kcal,530);
    assert.equal(state.history.at(-1).diary.days['2026-11-07'][0].nutrition.kcal,920);
    const recoveryKeys=await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('cloud-herstel')));
    assert.equal(recoveryKeys.length,0,'Herstelkopie moet worden gewist na bevestigde cloudsynchronisatie');
    await p.screenshot({path:output+'/cloud-herstel.png'});
    return {restoredRevision:state.row.revision,previousVersionPreserved:true};
   }finally{await c.close();}
  });

  await run('6. Accountknop opent zichtbare back-upinstellingen',async()=>{
   const {c,p}=await context(false);
   try{
    await p.addInitScript(cloudStub);
    await open(p);
    await p.locator('#selectedDate').fill('2026-11-07');
    await p.locator('#entries .entry-disclosure').first().waitFor();
    await p.locator('#openAccountTools').click();
    await p.locator('#cloudBackup').click();
    assert.equal(await p.locator('#settingsMenu').getAttribute('open'),'','Instellingen en beheer is nog ingeklapt');
    assert.equal(await p.locator('#secureBackupOptions').getAttribute('open'),'','Versleutelde back-upsectie opent niet');
    assert.equal(await p.locator('#backupPass').isVisible(),true,'Wachtzinveld niet zichtbaar');
    await p.screenshot({path:output+'/backup-via-account.png'});
    return {visible:true};
   }finally{await c.close();}
  });
  await run('7. Oudere back-up zonder standaardgerechten blijft te herstellen',async()=>{
   const {c,p}=await context();
   try{
    await open(p);
    await p.evaluate(()=>window.confirm=()=>true);
    const legacy=clone(target);delete legacy.quickMeals;
    await importFile(p,payload(legacy));
    await waitFor(p,()=>document.querySelector('#status').textContent.includes('hersteld'));
    assert.deepEqual(await current(p),{...target,quickMeals:[]});
    await p.reload({waitUntil:'domcontentloaded'});
    assert.deepEqual(await current(p),{...target,quickMeals:[]});
    return {legacyRestored:true,quickMeals:0};
   }finally{await c.close();}
  });
 }catch(err){console.error('INFRASTRUCTUURFOUT',err.stack);process.exitCode=2;}
 finally{
  if(browser)await browser.close();
  server.kill();
  fs.writeFileSync(output+'/resultaten.json',JSON.stringify(tests,null,2));
  console.log('HERSTELTEST '+tests.filter(x=>x.ok).length+'/'+tests.length+' geslaagd');
  if(tests.length!==7||tests.some(x=>!x.ok))process.exitCode=1;
 }
})();
