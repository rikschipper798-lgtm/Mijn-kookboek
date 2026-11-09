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
 const rows=new Map();
 let failWrite=false,failRead=false,holdRead=false,releaseRead=null;
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
   return {data:{revision:body.revision},error:null};
  }
  const old=rows.get(account);
  if(!old||old.revision!==filters.revision)return {data:null,error:null};
  rows.set(account,{...old,...copy(body)});
  return {data:{revision:body.revision},error:null};
 };
 return {
  rows,failNextWrite(){failWrite=true;},failNextRead(){failRead=true;},holdNextRead(){holdRead=true;},
  release(){assert.equal(typeof releaseRead,'function');releaseRead();releaseRead=null;},
  client(account){
   return {from(name){
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
 callbacks.onData=data=>{callbacks.current=data?copy(data):null;};
 callbacks.onLogout=()=>{callbacks.current=null;};
 callbacks.validateData=data=>data?copy(data):null;
 callbacks.getLocal=()=>local;
 callbacks.hasLocal=()=>!!local;
 callbacks.getState=()=>callbacks.current;
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
 await a.flush();
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
 await a.start();db.failNextWrite();a.enqueue(diary(210));await a.flush();
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
