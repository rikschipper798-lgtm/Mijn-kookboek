'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{chromium}=require('playwright'),axe=require('axe-core');
const PORT=8782,BASE='http://127.0.0.1:'+PORT+'/',OUT='account-testresultaten';
const root=path.resolve(__dirname,'..','_site'),D=require('../account-data.js');
const DATE='2026-11-17',clone=x=>JSON.parse(JSON.stringify(x));
const diary=title=>({goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},days:{[DATE]:[{id:'lunch',source:'manual',title,nutrition:{kcal:500,proteinG:30,carbsG:50,fatG:20,fiberG:5}}]},weekdayPresets:{},weekdayApplied:{},quickMeals:[]});
const personal=name=>({favorites:[name],ingredientChecks:{},basket:{},basketChecks:{},notes:{gerecht:{notes:'Meer knoflook',rating:4}},cookProgress:{},pantry:[{id:'rijst',name:'Rijst',group:'Droge voorraad en basisproducten',have:true}]});
const seed=()=>({diary:diary('Oorspronkelijke lunch'),personal:personal('bruschetta')});
const backup=data=>({app:'mijn-kookboek-alle-gegevens',version:1,exportedAt:new Date().toISOString(),data});
const rows=new Map(),offline=new Set(),results=[];let browser,activePage,serial=0;
fs.mkdirSync(OUT,{recursive:true});
const server=spawn('python3',['-m','http.server',String(PORT),'--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function put(account,data,revision=1){rows.set(account+':nutrition_diaries',{diary:clone(data.diary),revision});rows.set(account+':cookbook_personal_data',{data:clone(data.personal),revision});}
function rpc({table,account,device,mode,body,filters}){
 if(offline.has(device))return {data:null,error:{message:'Geen verbinding'}};
 if(!account||mode==='insert'&&body.user_id!==account||mode!=='insert'&&filters.user_id!==account)return {data:null,error:{message:'RLS'}};
 if(table==='nutrition_diary_history')return {data:[],error:null};
 if(!['nutrition_diaries','cookbook_personal_data'].includes(table))throw Error(table);
 const key=account+':'+table,old=rows.get(key),field=table==='nutrition_diaries'?'diary':'data';
 if(mode==='read')return {data:old?clone(old):null,error:null};
 if(mode==='insert'&&old||mode==='update'&&(!old||old.revision!==filters.revision))return {data:null,error:null};
 rows.set(key,{[field]:clone(body[field]),revision:body.revision});return {data:{revision:body.revision},error:null};
}
async function device(width=390,cloud=true){
 const id='device-'+(++serial),account='user-'+serial,data=seed();put(account,data);
 const context=await browser.newContext({viewport:{width,height:900},locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block',reducedMotion:'reduce',acceptDownloads:true});
 await context.exposeBinding('__accountRpc',(_,request)=>rpc(request));
 await context.route('**/cloud-config.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.COOKBOOK_CLOUD_CONFIG={active:'+cloud+',url:"https://account-test.supabase.co",publishableKey:"sb_publishable_account_browser_test_12345"};'}));
 await context.addInitScript(({account,id,data,storage,cloud})=>{
  if(!localStorage.getItem('account-test-seeded')){
   for(const [field,key] of Object.entries(storage))localStorage.setItem(key,JSON.stringify(data.personal[field]));
   if(!cloud)localStorage.setItem('mijn-kookboek-voedingsdagboek',JSON.stringify(data.diary));
   localStorage.setItem('mijn-kookboek-persoonlijk-account-v1',JSON.stringify({userId:account,revision:1,version:1}));
   localStorage.setItem('account-test-seeded','yes');
  }
  let user={id:account,email:account+'@example.invalid'};const listeners=[];
  window.__clientCount=0;
  window.__switchAccount=id=>{user=id?{id,email:id+'@example.invalid'}:null;for(const listener of listeners)listener(user?'SIGNED_IN':'SIGNED_OUT',user?{user}:null);};
  window.supabase={createClient(){
   window.__clientCount++;
   return {auth:{async getSession(){return {data:{session:user?{user}:null},error:null};},onAuthStateChange(fn){listeners.push(fn);return {};},async signOut(){window.__switchAccount(null);return {error:null};},async signInWithOtp(){return {error:null};}},from(table){
    const account=user?.id;let mode='read',body=null,filters={};
    return {select(){return this;},eq(key,value){filters[key]=value;return this;},insert(value){mode='insert';body=value;return this;},update(value){mode='update';body=value;return this;},order(){return this;},async limit(){return {data:[],error:null};},async maybeSingle(){return window.__accountRpc({table,account,device:id,mode,body,filters});},async single(){return this.maybeSingle();}};
   }};
  }};
 },{account,id,data,storage:D.STORAGE,cloud});
 const page=await context.newPage(),errors=[];activePage=page;page.setDefaultTimeout(12000);
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.clock.setFixedTime(new Date(DATE+'T12:00:00+01:00'));
 await page.goto(BASE+'voeding.html#account');
 await page.waitForFunction(()=>!document.querySelector('#allBackupDownload').disabled);
 return {context,page,id,account,errors,data};
}
async function upload(page,value){await page.locator('#allBackupFile').setInputFiles({name:'back-up.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}
async function downloaded(page,button){const promise=page.waitForEvent('download');await page.locator(button).click();const file=await promise;return JSON.parse(fs.readFileSync(await file.path(),'utf8'));}
async function settled(page){await page.waitForFunction(()=>document.querySelector('#diaryDataState').textContent==='Opgeslagen'&&document.querySelector('#personalDataState').textContent==='Opgeslagen');}
async function run(name,task){
 try{await task();results.push({name,ok:true});console.log('GESLAAGD | '+name);}
 catch(error){results.push({name,ok:false,error:error.stack});console.log('MISLUKT | '+name+' | '+error.stack);if(activePage&&!activePage.isClosed())await activePage.screenshot({path:path.join(OUT,'fout-'+results.length+'.png'),fullPage:true}).catch(()=>{});}
}
(async()=>{
 try{
  for(let n=0;n<60;n++){try{if((await fetch(BASE+'voeding.html')).ok)break;}catch{}if(n===59)throw Error('Server niet bereikbaar');await wait(100);}
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [390,1280])await run('Gezamenlijke export, herstel, encryptie en toegankelijkheid op '+width,async()=>{
   const t=await device(width),p=t.page;
   try{
    assert.equal(await p.locator('#pageTitle').innerText(),'Mijn account en gegevens');assert.equal(await p.locator('#diaryContent').isVisible(),false);assert.equal(await p.evaluate(()=>window.__clientCount),1);
    const file=await downloaded(p,'#allBackupDownload');assert.deepEqual(file.data,t.data);
    await p.addScriptTag({content:axe.source});
    const violations=await p.evaluate(async()=>(await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(x=>({id:x.id,targets:x.nodes.map(n=>n.target)})));
    assert.deepEqual(violations,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await p.screenshot({path:path.join(OUT,'account-'+width+'.png'),fullPage:true});
    const target={diary:diary('Herstelde avondmaaltijd'),personal:personal('hutspot')};
    await upload(p,backup(target));await p.locator('#allBackupPreview').waitFor({state:'visible'});
    assert.deepEqual(rows.get(t.account+':nutrition_diaries').diary,t.data.diary);
    await p.locator('#allBackupRestore').click();await settled(p);
    assert.deepEqual(rows.get(t.account+':nutrition_diaries').diary,target.diary);assert.deepEqual(rows.get(t.account+':cookbook_personal_data').data,target.personal);
    await p.locator('#allSecureBackup>summary').click();await p.locator('#allBackupPass').fill('Een sterke wachtzin 2026');await p.locator('#allBackupPassConfirm').fill('Een sterke wachtzin 2026');
    const encrypted=await downloaded(p,'#allBackupEncrypted');assert.ok(encrypted.ciphertext);assert.equal(encrypted.data,undefined);assert.equal(await p.locator('#allBackupPass').inputValue(),'');
    await upload(p,encrypted);await p.locator('#allBackupDecryptPass').fill('onjuiste wachtzin');await p.locator('#allBackupDecrypt').click();
    await p.waitForFunction(()=>document.querySelector('#allBackupStatus').textContent.includes('Ontsleutelen mislukt'));assert.equal(await p.locator('#allBackupPreview').isVisible(),false);
    await p.locator('#allBackupDecryptPass').fill('Een sterke wachtzin 2026');await p.locator('#allBackupDecrypt').click();await p.locator('#allBackupPreview').waitFor({state:'visible'});
    await p.locator('#allBackupCancel').click();assert.deepEqual(rows.get(t.account+':nutrition_diaries').diary,target.diary);
    await p.reload();await settled(p);assert.deepEqual((await downloaded(p,'#allBackupDownload')).data,target);assert.deepEqual(t.errors,[]);
   }finally{await t.context.close();}
  });
  await run('Ongeldig onderdeel en opslagfout laten beide onderdelen intact',async()=>{
   const t=await device(),p=t.page;
   try{
    const invalid=backup(seed());invalid.data.personal.notes={x:{rating:99}};await upload(p,invalid);
    await p.waitForFunction(()=>document.querySelector('#allBackupStatus').textContent.includes('Bestand niet hersteld'));assert.equal(await p.locator('#allBackupPreview').isVisible(),false);
    const target={diary:diary('Ander dagboek'),personal:personal('ander-gerecht')};await upload(p,backup(target));await p.locator('#allBackupPreview').waitFor({state:'visible'});
    await p.evaluate(()=>{const set=Storage.prototype.setItem;let fail=true;Storage.prototype.setItem=function(key,value){if(fail&&key==='mijn-kookboek-persoonlijke-notities'){fail=false;throw new DOMException('Quota','QuotaExceededError');}return set.call(this,key,value);};});
    await p.locator('#allBackupRestore').click();await p.waitForFunction(()=>document.querySelector('#allBackupStatus').textContent.includes('oorspronkelijke gegevens zijn teruggezet'));
    assert.deepEqual((await downloaded(p,'#allBackupDownload')).data,t.data);
    await wait(900);assert.equal(rows.get(t.account+':nutrition_diaries').revision,1);assert.equal(rows.get(t.account+':cookbook_personal_data').revision,1);
    assert.equal(await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('herstel-v1:')).length),0);
   }finally{await t.context.close();}
  });
  await run('Oude losse back-ups en gewijzigd tabblad worden correct afgehandeld',async()=>{
   const t=await device(),p=t.page;
   try{
    const target=diary('Uit oud bestand');await upload(p,{app:'mijn-kookboek-voedingsdagboek',version:1,data:target});await p.locator('#allBackupPreview').waitFor({state:'visible'});
    assert.match(await p.locator('#allBackupScope').innerText(),/alleen je dagboek/);await p.locator('#allBackupRestore').click();await settled(p);
    assert.deepEqual(rows.get(t.account+':nutrition_diaries').diary,target);assert.deepEqual(rows.get(t.account+':cookbook_personal_data').data,t.data.personal);
    await upload(p,backup(seed()));await p.locator('#allBackupPreview').waitFor({state:'visible'});
    const other=await t.context.newPage();await other.goto(BASE+'privacy.html');await other.evaluate(()=>localStorage.setItem('mijn-kookboek-favorieten','["wijziging-in-ander-tabblad"]'));
    await p.locator('#allBackupRestore').click();await p.waitForFunction(()=>document.querySelector('#allBackupStatus').textContent.includes('intussen gewijzigd'));
    assert.deepEqual(rows.get(t.account+':nutrition_diaries').diary,target);await other.close();
   }finally{await t.context.close();}
  });
  await run('Offline herstel, verschillen bekijken, stale keuze en hervatten',async()=>{
   const t=await device(),p=t.page;
   try{
    offline.add(t.id);const local={diary:diary('Lokale maaltijd'),personal:personal('lokaal-gerecht')};await upload(p,backup(local));await p.locator('#allBackupPreview').waitFor({state:'visible'});await p.locator('#allBackupRestore').click();
    await p.waitForFunction(()=>document.querySelector('#diaryDataState').textContent==='Wacht op verbinding'&&document.querySelector('#personalDataState').textContent==='Wacht op verbinding');
    assert.deepEqual((await downloaded(p,'#allBackupDownload')).data,local);
    await p.reload();await p.waitForFunction(()=>!document.querySelector('#allBackupDownload').disabled);assert.deepEqual((await downloaded(p,'#allBackupDownload')).data,local);
    const remote={diary:diary('Cloudmaaltijd'),personal:personal('cloud-gerecht')};remote.personal.notes.gerecht.notes='<img src=x onerror="window.__xss=true">';put(t.account,remote,2);
    offline.delete(t.id);await p.evaluate(()=>dispatchEvent(new Event('online')));
    await p.waitForFunction(()=>document.querySelector('#diaryDataState').textContent==='Actie nodig'&&document.querySelector('#personalDataState').textContent==='Actie nodig');
    await p.locator('#diaryCompare').click();await p.locator('#diaryConflictReview').waitFor({state:'visible'});
    assert.match(await p.locator('#diaryConflictReview').innerText(),/Lokale maaltijd/);assert.match(await p.locator('#diaryConflictReview').innerText(),/Cloudmaaltijd/);
    await p.locator('#diaryConflictReview').screenshot({path:path.join(OUT,'dagboek-verschillen.png')});
    rows.set(t.account+':nutrition_diaries',{diary:diary('Nog nieuwere cloudmaaltijd'),revision:3});
    await p.locator('#diaryConflictReview [data-choice="cloud"]').click();await p.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('intussen gewijzigd'));
    assert.ok(await p.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('mijn-kookboek-cloud-herstel-v1:'))));
    await p.locator('#diaryCompare').click();await p.locator('#diaryConflictReview [data-choice="cloud"]').click();
    await p.waitForFunction(()=>document.querySelector('#diaryDataState').textContent==='Opgeslagen');
    await p.locator('#personalCloudUpload').click();await p.locator('#personalConflictReview').waitFor({state:'visible'});
    assert.match(await p.locator('#personalConflictReview').innerText(),/img src=x/);assert.equal(await p.evaluate(()=>Boolean(window.__xss)),false);
    await p.locator('#personalConflictReview').screenshot({path:path.join(OUT,'kookboek-verschillen.png')});
    await p.locator('#personalConflictReview [data-choice="local"]').click();await settled(p);
    assert.deepEqual(rows.get(t.account+':cookbook_personal_data').data,local.personal);assert.equal(rows.get(t.account+':cookbook_personal_data').revision,3);
    assert.equal(rows.get(t.account+':nutrition_diaries').diary.days[DATE][0].title,'Nog nieuwere cloudmaaltijd');assert.deepEqual(t.errors,[]);
   }finally{offline.delete(t.id);await t.context.close();}
  });
  await run('Accountwissel trekt de herstelpreview in en voorkomt gemengde export',async()=>{
   const t=await device(),p=t.page;
   try{
    await upload(p,backup(seed()));await p.locator('#allBackupPreview').waitFor({state:'visible'});
    put('ander-account',{diary:diary('Eigen ander dagboek'),personal:personal('andere-favoriet')});
    await p.evaluate(()=>window.__switchAccount('ander-account'));
    await p.locator('#allBackupPreview').waitFor({state:'hidden'});await p.waitForFunction(()=>document.querySelector('#personalDataState').textContent==='Actie nodig');
    assert.equal(await p.locator('#allBackupDownload').isDisabled(),true);assert.equal(rows.get('ander-account:cookbook_personal_data').data.favorites[0],'andere-favoriet');assert.deepEqual(t.errors,[]);
   }finally{await t.context.close();}
  });
  await run('Gezamenlijke lokale back-up werkt zonder cloudaccount',async()=>{
   const t=await device(390,false),p=t.page;
   try{assert.deepEqual((await downloaded(p,'#allBackupDownload')).data,t.data);assert.match(await p.locator('#diaryDataState').innerText(),/dit apparaat/);assert.deepEqual(t.errors,[]);}finally{await t.context.close();}
  });
 }finally{fs.writeFileSync(path.join(OUT,'resultaten.json'),JSON.stringify(results,null,2));if(browser)await browser.close();server.kill();}
 if(results.some(r=>!r.ok))process.exitCode=1;
})().catch(error=>{console.error(error);server.kill();process.exitCode=1;});
