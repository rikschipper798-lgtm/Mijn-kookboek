'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'voeding-cloud.js'),'utf8');
const html=fs.readFileSync(path.join(root,'voeding.html'),'utf8');
const config=fs.readFileSync(path.join(root,'cloud-config.js'),'utf8');
const schema=fs.readFileSync(path.join(root,'supabase/schema.sql'),'utf8');
const copy=v=>JSON.parse(JSON.stringify(v));
const diary=kcal=>({
 goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
 days:{'2026-11-09':[{id:'entry',title:'Test',source:'manual',
  nutrition:{kcal,proteinG:10,carbsG:10,fatG:10,fiberG:2}}]},
 weekdayPresets:{},weekdayApplied:{}
});
const wait=()=>new Promise(resolve=>setTimeout(resolve,20));

function makeStorage(){
 const data=new Map();let blocked=false;
 return {
  data,block(flag){blocked=flag;},
  getItem(key){if(blocked)throw Error('Storage unavailable');return data.has(key)?data.get(key):null;},
  setItem(key,value){if(blocked)throw Error('Storage unavailable');data.set(key,value);},
  removeItem(key){if(blocked)throw Error('Storage unavailable');data.delete(key);}
 };
}
function makeDb(){
 const rows=new Map(),history=new Map();
 let failWrite=false,failRead=false,holdRead=false,releaseRead=null,loseAcknowledgement=false,holdWrite=false,releaseWrite=null;
 const result=async(account,kind,body,filters)=>{
  if(kind==='select'){
   if(failRead){failRead=false;return {data:null,error:{code:'NETWORK',message:'No internet'}};}
   const row=rows.get(account);
   const value=row?{diary:copy(row.diary),revision:row.revision}:null;
   if(holdRead){
    holdRead=false;
    return new Promise(resolve=>{releaseRead=()=>resolve({data:value,error:null});});
   }
   return {data:value,error:null};
  }
  if(failWrite){failWrite=false;return {data:null,error:{code:'NETWORK',message:'No internet'}};}
  if(kind==='insert'){
   if(body.user_id!==account)return {data:null,error:{code:'RLS',message:'forbidden'}};
   if(rows.has(account))return {data:null,error:{code:'23505',message:'duplicate key'}};
   rows.set(account,copy(body));
   if(holdWrite){
    holdWrite=false;
    return new Promise(resolve=>{releaseWrite=()=>resolve({data:{revision:body.revision},error:null});});
   }
   if(loseAcknowledgement){
    loseAcknowledgement=false;return {data:null,error:{code:'NETWORK',message:'Lost HTTP acknowledgement'}};
   }
   return {data:{revision:body.revision},error:null};
  }
  const old=rows.get(account);
  if(!old||old.revision!==filters.revision)return {data:null,error:null};
  const versions=history.get(account)||[];
  versions.push({revision:old.revision,diary:copy(old.diary),saved_at:new Date().toISOString()});
  history.set(account,versions.slice(-3));
  rows.set(account,{...old,...copy(body)});
  if(holdWrite){
   holdWrite=false;
   return new Promise(resolve=>{releaseWrite=()=>resolve({data:{revision:body.revision},error:null});});
  }
  if(loseAcknowledgement){
   loseAcknowledgement=false;return {data:null,error:{code:'NETWORK',message:'Lost HTTP acknowledgement'}};
  }
  return {data:{revision:body.revision},error:null};
 };
 return {
  rows,history,failNextWrite(){failWrite=true;},failNextRead(){failRead=true;},loseNextAcknowledgement(){loseAcknowledgement=true;},holdNextRead(){holdRead=true;},holdNextWriteResponse(){holdWrite=true;},releaseWriteResponse(){assert.equal(typeof releaseWrite,'function');releaseWrite();releaseWrite=null;},
  release(){assert.equal(typeof releaseRead,'function');releaseRead();releaseRead=null;},
  client(account){
   return {from(name){
    if(name==='nutrition_diary_history'){
     const q={
      select(){return q;},
      eq(key,value){assert.equal(key,'user_id');assert.equal(value,account);return q;},
      order(){return q;},
      async limit(count){
       const values=[...(history.get(account)||[])].reverse().slice(0,count);
       return {data:values,error:null};
      }
     };
     return q;
    }
    assert.equal(name,'nutrition_diaries');
    let kind='select',body=null,filters={};
    const q={
     select(){return q;},eq(k,v){filters[k]=v;return q;},
     insert(value){kind='insert';body=value;return q;},
     update(value){kind='update';body=value;return q;},
     async maybeSingle(){return result(account,kind,body,filters);},
     async single(){return result(account,kind,body,filters);}
    };
    return q;
   },auth:{
    onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
    async getSession(){return {data:{session:{user:{id:account,email:account+'@example.org'}}},error:null};},
    async signInWithOtp(){return {error:null};},async signOut(){return {error:null};}
   }};
  }
 };
}
function harness(db,account,storage,{local=null}={}){
 const elements={},listeners={},callbacks={};
 const el=id=>elements[id]??={
  value:'',textContent:'',hidden:false,disabled:false,
  classList:{toggle(){}},addEventListener(type,fn){this[type]=fn;},
  checkValidity(){return true;}
 };
 const win={
  COOKBOOK_CLOUD_CONFIG:{active:true,url:'https://sample.supabase.co',
   publishableKey:'sb_publishable_example_public_key_0123456789'},
  supabase:{createClient(){return db.client(account);}},
  localStorage:storage,confirm(){return true;},
  addEventListener(name,fn){listeners[name]=fn;}
 };
 const document={getElementById:el,addEventListener(name,fn){listeners[name]=fn;}};
 vm.runInNewContext(script,{window:win,document,
  location:{origin:'https://example.org',pathname:'/voeding.html'},
  setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,3)),clearTimeout,
  Date,Math,JSON,Error,Promise,Number,String},{filename:'voeding-cloud.js',timeout:1500});
 const cloud=win.CookbookCloud;
 callbacks.current=null;
 callbacks.uiStatus=null;
 callbacks.onStatus=info=>{callbacks.uiStatus={...info};};
 callbacks.onData=data=>{callbacks.current=data?copy(data):null;};
 callbacks.onLogout=()=>{callbacks.current=null;};
 callbacks.validateData=data=>data?copy(data):null;
 callbacks.getLocal=()=>local;
 callbacks.hasLocal=()=>!!local;
 callbacks.getState=()=>callbacks.current;
 callbacks.restoreVersion=data=>{
  if(!cloud.enqueue(data))return false;
  callbacks.current=copy(data);
  return true;
 };
 return {
  cloud,storage,callbacks,listeners,elements,
  start:()=>cloud.start(callbacks),
  enqueue(d){const ok=cloud.enqueue(d);if(ok)callbacks.current=copy(d);return ok;},
  async flush(){cloud.retry();await wait();},
  async refresh(){listeners.online();await wait();},
  get state(){return callbacks.current;},
  get status(){return el('cloudStatus').textContent;}
 };
}
const countPending=storage=>[...storage.data.keys()].filter(k=>k.includes('mijn-kookboek-cloud-herstel-v1')).length;

test('Configuratie en toegangsregels zijn in overeenstemming met productie',()=>{
 assert.match(config,/active:\s*true/);
 assert.match(config,/sb_publishable_/);
 assert.doesNotMatch(config,/sb_secret_\S+/);
 assert.match(html,/if\(!window\.CookbookCloud\.enqueue\(state\)\)/);
 assert.match(schema,/enable row level security/);
 assert.match(schema,/revoke all privileges on table public\.nutrition_diaries from anon, authenticated, public/);
 assert.match(schema,/with check \(user_id = \(select auth\.uid\(\)\)\)/);
});


test('Accountbalk maakt cloudstatus en lokale opslag ondubbelzinnig zichtbaar',async()=>{
 assert.match(html,/id="accountStatusBar"/);
 assert.match(html,/id="accountStateLabel"/);
 assert.match(html,/id="accountStorageNote"/);
 assert.match(html,/Favorieten, boodschappen, standaardvoorraad, kooknotities/);
 assert.ok(html.indexOf('id="accountTools"')<html.indexOf('id="diaryContent"'),
  'Inloggen moet boven het afgeschermde dagoverzicht staan');
 assert.match(html,/onStatus\(snapshot\)\{updateAccountStatus\(snapshot\);\}/);
 const db=makeDb(),storage=makeStorage(),account=harness(db,'account-status',storage);
 await account.start();
 assert.equal(account.callbacks.uiStatus.loggedIn,true);
 assert.equal(account.callbacks.uiStatus.pending,false);
 assert.equal(account.callbacks.uiStatus.conflict,false);
 assert.match(account.callbacks.uiStatus.message,/gesynchroniseerd/i);
 account.enqueue(diary(410));
 assert.equal(account.callbacks.uiStatus.pending,true);
 assert.match(account.callbacks.uiStatus.message,/lokaal bewaard/i);
 await account.flush();
 assert.equal(account.callbacks.uiStatus.pending,false);
 assert.equal(account.callbacks.uiStatus.conflict,false);
 assert.match(account.callbacks.uiStatus.message,/gesynchroniseerd/i);
});

test('Lokale herstelkopie staat synchroon op schijf vóór verzending',async()=>{
 const db=makeDb(),store=makeStorage(),a=harness(db,'a',store);
 await a.start();
 assert.equal(a.enqueue(diary(350)),true);
 assert.equal(countPending(store),1);
 assert.equal(JSON.parse([...store.data.values()][0]).diary.days['2026-11-09'][0].nutrition.kcal,350);
 await a.flush();
 assert.equal(db.rows.get('a').diary.days['2026-11-09'][0].nutrition.kcal,350);
 assert.equal(countPending(store),0);
});

test('Verbindingsverlies en pagina herladen: herstel wordt teruggevonden en daarna gesynchroniseerd',async()=>{
 const db=makeDb(),store=makeStorage(),a=harness(db,'a',store);
 await a.start();db.failNextWrite();assert.equal(a.enqueue(diary(425)),true);
 await wait(); // Laat eerste automatische poging falen, zonder een tweede retry.
 assert.equal(countPending(store),1);
 assert.equal(db.rows.size,0);
 const reopened=harness(db,'a',store);
 await reopened.start();
 assert.equal(reopened.state.days['2026-11-09'][0].nutrition.kcal,425);
 await reopened.flush();
 assert.equal(db.rows.get('a').diary.days['2026-11-09'][0].nutrition.kcal,425);
 assert.equal(countPending(store),0);
});

test('Tijdens cloud refresh mag nieuwere lokale invoer niet worden vervangen',async()=>{
 const db=makeDb(),store=makeStorage(),a=harness(db,'a',store);
 await a.start();a.enqueue(diary(200));await a.flush();
 db.holdNextRead();
 // Begin a refresh and leave its response unresolved.
 a.listeners.online();
 await wait();
 const newer=diary(470);
 assert.equal(a.enqueue(newer),true);
 db.release();await wait();
 assert.equal(a.state.days['2026-11-09'][0].nutrition.kcal,470);
 assert.match(a.status,/genegeerd|gesynchroniseerd|opgeslagen|cloudsync/i);
 await a.flush();
 assert.equal(db.rows.get('a').diary.days['2026-11-09'][0].nutrition.kcal,470);
});

test('Een tweede apparaat met verouderde revisie overschrijft het eerste niet',async()=>{
 const db=makeDb(),one=harness(db,'a',makeStorage());
 await one.start();one.enqueue(diary(150));await one.flush();
 const two=harness(db,'a',makeStorage());await two.start();
 one.enqueue(diary(300));await one.flush();
 two.enqueue(diary(600));await two.flush();
 assert.equal(db.rows.get('a').diary.days['2026-11-09'][0].nutrition.kcal,300);
 assert.equal(countPending(two.storage),1);
 assert.match(two.status,/conflict/i);
});

test('Lokale herstelkopieën van verschillende accounts worden niet gecombineerd',async()=>{
 const db=makeDb(),shared=makeStorage();
 const a=harness(db,'alice',shared),b=harness(db,'bob',shared);
 await a.start();db.failNextWrite();a.enqueue(diary(300));
 await wait(); // Simuleer een onderbroken upload: account A behoudt zijn herstelkopie.
 await b.start();assert.equal(b.state,null);
 b.enqueue(diary(500));
 assert.equal(countPending(shared),2);
 assert.notEqual([...shared.data.keys()][0],[...shared.data.keys()][1]);
});

test('Browseropslag niet beschikbaar: invoer wordt geweigerd',async()=>{
 const db=makeDb(),storage=makeStorage(),a=harness(db,'a',storage);
 await a.start();storage.block(true);
 assert.equal(a.enqueue(diary(123)),false);
 storage.block(false);
 assert.equal(db.rows.size,0);
 assert.equal(countPending(storage),0);
 assert.match(a.status,/niet veilig|opslag/i);
});

test('Na bevestigde cloudschrijfactie en browsercrash wordt de herstelkopie herkend',async()=>{
 const db=makeDb(),store=makeStorage(),a=harness(db,'a',store);
 await a.start();a.enqueue(diary(300));await a.flush();
 const original=db.rows.get('a');
 original.revision=2;original.diary=diary(410);
 const key='mijn-kookboek-cloud-herstel-v1:https://sample.supabase.co:a';
 store.setItem(key,JSON.stringify({version:1,userId:'a',baseRevision:1,nonce:'crash',
  diary:diary(410),savedAt:new Date().toISOString()}));
 const reopened=harness(db,'a',store);await reopened.start();
 assert.equal(reopened.state.days['2026-11-09'][0].nutrition.kcal,410);
 assert.equal(countPending(store),0);
 assert.doesNotMatch(reopened.status,/conflict/i);
});

test('Herstelkopie is ook tijdens offline herstart beschikbaar en wordt later veilig geüpload',async()=>{
 const db=makeDb(),store=makeStorage(),a=harness(db,'offline',store);
 await a.start();db.failNextWrite();a.enqueue(diary(210));await wait(); // Eerste poging mislukt.
 assert.equal(countPending(store),1);
 db.failNextRead();
 const reopened=harness(db,'offline',store);await reopened.start();
 assert.equal(reopened.state.days['2026-11-09'][0].nutrition.kcal,210);
 assert.match(reopened.status,/Geen cloudverbinding/);
 reopened.enqueue(diary(360));
 await reopened.flush();
 assert.equal(db.rows.get('offline').diary.days['2026-11-09'][0].nutrition.kcal,360);
 assert.equal(countPending(store),0);
});

test('Twee tabbladen kunnen niet stilzwijgend dezelfde lokale herstelkopie overschrijven',async()=>{
 const db=makeDb(),store=makeStorage();
 const left=harness(db,'a',store),right=harness(db,'a',store);
 await left.start();await right.start();
 assert.equal(left.enqueue(diary(350)),true);
 assert.equal(right.enqueue(diary(750)),false);
 const saved=JSON.parse([...store.data.values()][0]);
 assert.equal(saved.diary.days['2026-11-09'][0].nutrition.kcal,350);
 assert.match(right.status,/ander tabblad/i);
});

test('Cloudconflict op herstart houdt het ongesynchroniseerde dagboek intact',async()=>{
 const db=makeDb(),store=makeStorage(),one=harness(db,'a',makeStorage());
 await one.start();one.enqueue(diary(200));await one.flush();
 const oldRevision=db.rows.get('a').revision;
 const draft={version:1,userId:'a',baseRevision:oldRevision,nonce:'stale-draft',diary:diary(800),savedAt:new Date().toISOString()};
 store.setItem('mijn-kookboek-cloud-herstel-v1:https://sample.supabase.co:a',JSON.stringify(draft));
 one.enqueue(diary(250));await one.flush();
 const recovered=harness(db,'a',store);await recovered.start();
 assert.equal(recovered.state.days['2026-11-09'][0].nutrition.kcal,800);
 assert.equal(countPending(store),1);
 assert.match(recovered.status,/cloud is op een ander apparaat gewijzigd/i);
});

test('Tijdelijke netwerkfout is herstelbaar zonder onterechte conflictmelding',async()=>{
 const db=makeDb(),storage=makeStorage(),browser=harness(db,'retry',storage);
 await browser.start();
 db.failNextWrite();
 assert.equal(browser.enqueue(diary(440)),true);
 await wait(); // Laat één automatische poging uitvoeren.
 assert.equal(countPending(storage),1);
 assert.doesNotMatch(browser.status,/cloudconflict/i);
 await browser.flush();
 assert.equal(db.rows.get('retry').diary.days['2026-11-09'][0].nutrition.kcal,440);
 assert.equal(countPending(storage),0);
});

test('Conflicterende wijziging op het tweede apparaat blijft lokaal herstelbaar',async()=>{
 const db=makeDb(),first=harness(db,'shared',makeStorage());
 await first.start();first.enqueue(diary(111));await first.flush();
 const second=harness(db,'shared',makeStorage());await second.start();
 first.enqueue(diary(222));await first.flush();
 second.enqueue(diary(333));await second.flush();
 assert.equal(second.state.days['2026-11-09'][0].nutrition.kcal,333);
 assert.equal(countPending(second.storage),1);
 assert.equal(db.rows.get('shared').diary.days['2026-11-09'][0].nutrition.kcal,222);
});

test('Dagboekformulier toont een wijziging pas na een bevestigde lokale opslag',()=>{
 const source=html.match(/<script>\s*'use strict';[\s\S]*?<\/script>/);
 assert.equal(Boolean(source),true);
 const inline=source[0].replace(/^<script>/,'').replace(/<\/script>$/,'');
 function formCase(allow){
  const nodes={},listeners={};
  const node=id=>nodes[id]??={
   id,value:'',checked:false,hidden:false,disabled:false,style:{},dataset:{},
   textContent:'',innerHTML:'',classList:{toggle(){}},setAttribute(){},
   addEventListener(name,fn){(listeners[id]??={})[name]=fn;},
   focus(){},reset(){}
  };
  let saved=null;
  const cloud={enabled:true,start(callbacks){callbacks.onData(null);},
   enqueue(data){if(!allow)return false;saved=copy(data);return true;}};
  const sandbox={
   window:{CookbookCloud:cloud,confirm(){return true;}},
   document:{getElementById:node},
   location:{search:''},
   localStorage:{getItem(){return null},setItem(){}},
   fetch:async()=>({ok:true,json:async()=>[]}),
   URLSearchParams,Date,Math,JSON,Error,Promise,Number,String,
   setTimeout(){return 0;}
  };
  vm.runInNewContext(inline,sandbox,{timeout:1500});
  node('manualName').value='Test voor opslag';
  node('manualKcal').value='350';
  listeners.manualForm.submit({preventDefault(){}});
  return {saved,html:node('entries').innerHTML,message:node('status').textContent};
 }
 const failed=formCase(false);
 assert.equal(failed.saved,null);
 assert.doesNotMatch(failed.html,/Test voor opslag/);
 assert.match(failed.message,/niet opgeslagen/);
 const succeeded=formCase(true);
 assert.equal(succeeded.saved.days[Object.keys(succeeded.saved.days)[0]][0].nutrition.kcal,350);
 assert.match(succeeded.html,/Test voor opslag/);
});

test('Verloren netwerkbevestiging bij eerste upload wordt veilig als geslaagd herkend',async()=>{
 const db=makeDb(),store=makeStorage(),client=harness(db,'lost-insert',store);
 await client.start();
 db.loseNextAcknowledgement();
 assert.equal(client.enqueue(diary(410)),true);
 await client.flush();
 assert.equal(db.rows.get('lost-insert').diary.days['2026-11-09'][0].nutrition.kcal,410);
 assert.equal(countPending(store),0);
 assert.doesNotMatch(client.status,/conflict/i);
});

test('Verloren netwerkbevestiging bij update laat geen schijnconflict achter',async()=>{
 const db=makeDb(),store=makeStorage(),client=harness(db,'lost-update',store);
 await client.start();
 client.enqueue(diary(220));await client.flush();
 db.loseNextAcknowledgement();
 assert.equal(client.enqueue(diary(540)),true);
 await client.flush();
 assert.equal(db.rows.get('lost-update').diary.days['2026-11-09'][0].nutrition.kcal,540);
 assert.equal(db.rows.get('lost-update').revision,2);
 assert.equal(countPending(store),0);
 assert.doesNotMatch(client.status,/conflict/i);
});

test('Wijziging tijdens een lopende upload blijft behouden en wordt daarna apart gesynchroniseerd',async()=>{
 const db=makeDb(),store=makeStorage(),client=harness(db,'mid-flight',store);
 await client.start();
 db.holdNextWriteResponse();
 assert.equal(client.enqueue(diary(140)),true);
 await wait();
 assert.equal(db.rows.get('mid-flight').diary.days['2026-11-09'][0].nutrition.kcal,140);
 assert.equal(client.enqueue(diary(680)),true);
 assert.equal(countPending(store),1);
 db.releaseWriteResponse();
 await wait();
 assert.equal(db.rows.get('mid-flight').diary.days['2026-11-09'][0].nutrition.kcal,680);
 assert.equal(db.rows.get('mid-flight').revision,2);
 assert.equal(countPending(store),0);
 assert.doesNotMatch(client.status,/conflict/i);
});

test('Directe instelpagina schrijft niet buiten de persoonlijke dagboekopslag om',()=>{
 const page=fs.readFileSync(path.join(root,'instellen-vaste-maaltijden.html'),'utf8');
 assert.match(page,/voeding\.html#vaste-maaltijden=/);
 assert.doesNotMatch(page,/localStorage\.setItem/);
 assert.match(html,/function processPresetLink\(/);
 assert.match(html,/if\(!cloudMode\)processPresetLink\(\)/);
 assert.match(html,/onData\(data\)[\s\S]*?processPresetLink\(\)/);
});

test('Ingelogde instellink loopt via dezelfde commit- en cloudroute',()=>{
 const source=html.match(/<script>\s*'use strict';[\s\S]*?<\/script>/);
 assert.equal(Boolean(source),true);
 const inline=source[0].replace(/^<script>/,'').replace(/<\/script>$/,'');
 const elements={},listeners={};let cloudWrites=0,saved,removedHash=false;
 const preset={
  app:'mijn-kookboek-vaste-maaltijden',version:1,
  weekdayPresets:{
   ontbijt:{title:'Kip en hagelslag',enabled:true,startDate:'2026-11-09',nutrition:{kcal:276,proteinG:10,carbsG:37.1,fatG:8.1,fiberG:6.2}},
   lunch:{title:'Brood met ham en pasta',enabled:true,startDate:'2026-11-09',nutrition:{kcal:516,proteinG:19,carbsG:64.8,fatG:17.6,fiberG:11}}
  }
 };
 const el=id=>elements[id]??={
  value:'',checked:false,hidden:false,disabled:false,style:{},dataset:{},innerHTML:'',textContent:'',
  classList:{toggle(){}},setAttribute(){},addEventListener(k,fn){(listeners[id]??={})[k]=fn;},
  focus(){},reset(){}
 };
 const cloud={enabled:true,start(callbacks){callbacks.onData(null);},enqueue(data){cloudWrites++;saved=copy(data);return true;}};
 const sandbox={
  window:{CookbookCloud:cloud,confirm(){return true;}},
  document:{getElementById:el},
  location:{search:'',pathname:'/Mijn-kookboek/voeding.html',
   hash:'#vaste-maaltijden='+encodeURIComponent(JSON.stringify(preset))},
  history:{replaceState(){removedHash=true;}},
  localStorage:{getItem(){return null},setItem(){throw Error('Legacy storage must not be touched');}},
  fetch:async()=>({ok:true,json:async()=>[]}),
  URLSearchParams,Date,Math,JSON,Error,Promise,Number,String,setTimeout(){return 0;}
 };
 vm.runInNewContext(inline,sandbox,{timeout:1600});
 assert.equal(cloudWrites>0,true);
 assert.equal(saved.weekdayPresets.ontbijt.nutrition.kcal,276);
 assert.equal(saved.weekdayPresets.lunch.nutrition.kcal,516);
 assert.equal(removedHash,true);
});

test('Eerdere dagboekversie wordt via de normale sync hersteld en bewaart de huidige versie',async()=>{
 const db=makeDb(),store=makeStorage(),account=harness(db,'history-user',store);
 await account.start();
 account.enqueue(diary(120));await account.flush();
 account.enqueue(diary(290));await account.flush();
 assert.equal(db.history.get('history-user').length,1);
 assert.equal(db.history.get('history-user')[0].diary.days['2026-11-09'][0].nutrition.kcal,120);
 await account.elements.cloudHistoryLoad.onclick();
 assert.match(account.elements.cloudHistorySelect.innerHTML,/Versie 1/);
 account.elements.cloudHistorySelect.value='1';
 account.elements.cloudHistoryRestore.onclick();
 assert.equal(account.state.days['2026-11-09'][0].nutrition.kcal,120);
 await account.flush();
 assert.equal(db.rows.get('history-user').diary.days['2026-11-09'][0].nutrition.kcal,120);
 assert.equal(db.history.get('history-user').at(-1).diary.days['2026-11-09'][0].nutrition.kcal,290);
});
