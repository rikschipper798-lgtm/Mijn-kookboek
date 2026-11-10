'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../personal-cloud.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const sw=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const schema=fs.readFileSync(path.join(__dirname,'../supabase/cookbook-personal-data.sql'),'utf8');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const clone=x=>JSON.parse(JSON.stringify(x));
const data=(fav=[])=>({
 favorites:fav,ingredientChecks:{},basket:{},basketChecks:{},notes:{},cookProgress:{},
 pantry:[{id:'rijst',name:'Rijst',group:'Droge voorraad en basisproducten',have:true}]
});
class FakeDatabase{
 constructor(){this.records=new Map();this.online=true;this.failReads=false;this.failWrites=false;}
 query(table,identity){
  assert.equal(table,'cookbook_personal_data');
  let mode='read',body=null,filters={};
  const obj={
   select(){return this;},eq(field,value){filters[field]=value;return this;},
   insert(value){mode='insert';body=value;return this;},
   update(value){mode='update';body=value;return this;},
   async maybeSingle(){
    if(!thisDb.online||thisDb.failReads&&mode==='read'||thisDb.failWrites&&mode!=='read')
     return {data:null,error:{message:'Simulated network error'}};
    if(filters.user_id!==identity&&mode!=='insert')return {data:null,error:{message:'RLS violation'}};
    const row=thisDb.records.get(identity);
    if(mode==='read')return {data:row?clone(row):null,error:null};
    if(mode==='insert'){
     if(body.user_id!==identity)return {data:null,error:{message:'RLS violation'}};
     if(row)return {data:null,error:{message:'Duplicate row'}};
     thisDb.records.set(identity,{data:clone(body.data),revision:body.revision});
     return {data:{revision:body.revision},error:null};
    }
    if(!row||row.revision!==filters.revision)return {data:null,error:null};
    thisDb.records.set(identity,{data:clone(body.data),revision:body.revision});
    return {data:{revision:body.revision},error:null};
   },
   async single(){return this.maybeSingle();}
  };
  const thisDb=this;
  return obj;
 }
}
function storage(initial){
 const map=new Map(initial||[]);
 return {
  map,
  getItem:key=>map.has(key)?map.get(key):null,
  setItem:(key,value)=>map.set(key,value),
  removeItem:key=>map.delete(key)
 };
}
function harness(db,id='user-1',{local=data(),store=storage(),signedIn=true}={}){
 let current=clone(local),canApply=true;
 const nodes=new Map(),logs=[];
 function node(key){
  if(nodes.has(key))return nodes.get(key);
  const callbacks={};
  const x={
   id:key,textContent:'',disabled:false,hidden:key==='personalCloudChoices',classList:{toggle(){}},
   callbacks,addEventListener(type,fn){callbacks[type]=fn;},
   click(){callbacks.click?.();}
  };
  nodes.set(key,x);return x;
 }
 const document={getElementById:node,visibilityState:'visible'};
 const user=signedIn?{id,email:id+'@example.invalid'}:null;
 const events={};
 const context={
  window:{
   COOKBOOK_CLOUD_CONFIG:{active:true,url:'https://test-cookbook.supabase.co',
    publishableKey:'sb_publishable_mock_test_account_key_123'},
   localStorage:store,prompt:()=> 'OVERSCHRIJF',confirm:()=>true,
   addEventListener(type,fn){events[type]=fn;},
   setInterval(){return 1;},
   supabase:{createClient:()=>({
    auth:{
     async getSession(){return {data:{session:user?{user}:null},error:null};},
     onAuthStateChange(){return {};}
    },
    from:table=>db.query(table,id)
   })}
  },
  document,localStorage:store,
  setTimeout:(fn,delay)=>setTimeout(fn,Math.min(delay,2)),
  clearTimeout,Date,Math,JSON,Error,Promise
 };
 vm.runInNewContext(code,context,{filename:'personal-cloud.js',timeout:1000});
 const cloud=context.window.CookbookPersonalCloud;
 cloud.start({
  getLocal:()=>clone(current),
  validate:value=>{
   assert.ok(value&&Array.isArray(value.favorites)&&Array.isArray(value.pantry),'Invalid test data');
   return clone(value);
  },
  apply:value=>{current=clone(value);logs.push('remote-applied');},
  canApply:()=>canApply,
  download:()=>{logs.push('download');return true;}
 });
 return {
  cloud,node,store,events,logs,
  ready:()=>pause(45),wait:()=>pause(70),
  local:()=>clone(current),
  setLocal(value){current=clone(value);cloud.changed();},
  setApplyAllowed(value){canApply=value;},
  chooseCloud(){node('personalCloudLoad').click();},
  chooseLocal(){node('personalCloudUpload').click();},
  sync(){node('personalCloudSync').click();}
 };
}
test('Accountkoppeling slaat niets op zonder expliciete keuze',async()=>{
 const db=new FakeDatabase(),h=harness(db,'a');
 await h.ready();
 assert.equal(db.records.size,0);
 assert.equal(h.local().favorites.length,0);
 assert.match(h.node('personalCloudStatus').textContent,/nog geen persoonlijke kookboekgegevens/i);
});
test('Eerste upload en nieuw apparaat: gegevens worden bewust overgenomen',async()=>{
 const db=new FakeDatabase(),first=harness(db,'a',{local:data(['bruschetta'])});
 await first.ready();first.chooseLocal();await first.wait();
 assert.deepEqual(db.records.get('a').data.favorites,['bruschetta']);
 assert.equal(db.records.get('a').revision,1);
 const second=harness(db,'a',{local:data([])});await second.ready();
 assert.deepEqual(second.local().favorites,[]);
 assert.ok(second.node('personalCloudChoices').hidden===false);
 second.chooseCloud();await second.wait();
 assert.deepEqual(second.local().favorites,['bruschetta']);
 assert.equal(second.store.getItem('mijn-kookboek-persoonlijk-account-v1')!==null,true);
});
test('Gebonden apparaten synchroniseren latere wijzigingen in beide richtingen',async()=>{
 const db=new FakeDatabase();db.records.set('a',{data:data(['start']),revision:1});
 const s1=storage([['mijn-kookboek-persoonlijk-account-v1',JSON.stringify({userId:'a',revision:1,version:1})]]);
 const s2=storage([['mijn-kookboek-persoonlijk-account-v1',JSON.stringify({userId:'a',revision:1,version:1})]]);
 const first=harness(db,'a',{store:s1,local:data(['start'])});
 const second=harness(db,'a',{store:s2,local:data(['start'])});
 await first.ready();await second.ready();
 first.setLocal(data(['start','hutspot']));await first.wait();
 assert.equal(db.records.get('a').revision,2);
 second.sync();await second.wait();
 assert.deepEqual(second.local().favorites,['start','hutspot']);
 second.setLocal(data(['start','hutspot','arayes']));await second.wait();
 first.sync();await first.wait();
 assert.deepEqual(first.local().favorites,['start','hutspot','arayes']);
});
test('Gelijktijdige bewerkingen geven een conflict zonder verlies van het tweede apparaat',async()=>{
 const db=new FakeDatabase();db.records.set('a',{data:data(['start']),revision:1});
 const h1=harness(db,'a',{store:storage([['mijn-kookboek-persoonlijk-account-v1',JSON.stringify({userId:'a',revision:1,version:1})]]),local:data(['start'])});
 const h2=harness(db,'a',{store:storage([['mijn-kookboek-persoonlijk-account-v1',JSON.stringify({userId:'a',revision:1,version:1})]]),local:data(['start'])});
 await h1.ready();await h2.ready();
 h1.setLocal(data(['start','telefoon']));await h1.wait();
 h2.setLocal(data(['start','laptop']));await h2.wait();
 assert.deepEqual(db.records.get('a').data.favorites,['start','telefoon']);
 assert.equal(db.records.get('a').revision,2);
 assert.match(h2.node('personalCloudStatus').textContent,/recentere versie|conflict|ander apparaat/i);
 const journal=h2.store.getItem('mijn-kookboek-persoonlijk-herstel-v1:a');
 assert.ok(journal);
 assert.deepEqual(JSON.parse(journal).data.favorites,['start','laptop']);
});
test('Offline wijziging blijft in herstelkopie en uploadt na herstelde verbinding',async()=>{
 const db=new FakeDatabase();db.records.set('a',{data:data(['start']),revision:1});
 const h=harness(db,'a',{store:storage([['mijn-kookboek-persoonlijk-account-v1',JSON.stringify({userId:'a',revision:1,version:1})]]),local:data(['start'])});
 await h.ready();
 db.online=false;h.setLocal(data(['start','offline']));await h.wait();
 assert.equal(db.records.get('a').revision,1);
 assert.ok(h.store.getItem('mijn-kookboek-persoonlijk-herstel-v1:a'));
 db.online=true;h.sync();await h.wait();
 assert.equal(db.records.get('a').revision,2);
 assert.equal(h.store.getItem('mijn-kookboek-persoonlijk-herstel-v1:a'),null);
});
test('Een ander account erft geen privégegevens van het vorige account',async()=>{
 const db=new FakeDatabase();db.records.set('ander',{data:data(['ander geheim']),revision:1});
 const st=storage([['mijn-kookboek-persoonlijk-account-v1',JSON.stringify({userId:'oud',revision:3,version:1})]]);
 const h=harness(db,'ander',{store:st,local:data(['lokaal-oud'])});await h.ready();
 assert.deepEqual(h.local().favorites,['lokaal-oud']);
 assert.equal(h.node('personalCloudChoices').hidden,false);
 assert.equal(h.store.getItem('mijn-kookboek-persoonlijk-account-v1')!==null,true);
});
test('Ongeldige cloudgegevens vervangen lokale gegevens niet',async()=>{
 const db=new FakeDatabase();db.records.set('a',{data:{unexpected:true},revision:2});
 const h=harness(db,'a',{store:storage([['mijn-kookboek-persoonlijk-account-v1',JSON.stringify({userId:'a',revision:1,version:1})]]),
  local:data(['lokale versie'])});
 await h.ready();
 assert.deepEqual(h.local().favorites,['lokale versie']);
 assert.match(h.node('personalCloudStatus').textContent,/niet worden geladen|niet worden overgenomen|ongeldig/i);
});
test('Open kook- of notitiebewerking blokkeert ongevraagde cloudvervanging',async()=>{
 const db=new FakeDatabase();db.records.set('a',{data:data(['nieuwe-cloud']),revision:2});
 const h=harness(db,'a',{store:storage([['mijn-kookboek-persoonlijk-account-v1',JSON.stringify({userId:'a',revision:1,version:1})]]),
  local:data(['oude-lokale-versie'])});
 h.setApplyAllowed(false);await h.ready();
 assert.deepEqual(h.local().favorites,['oude-lokale-versie']);
 assert.match(h.node('personalCloudStatus').textContent,/bewerkt|bewerking|kies bewust/i);
});
test('Koppeling is geïntegreerd met dezelfde lokale sleutels, back-up en PWA',()=>{
 assert.match(html,/id="personalCloudPanel"/);
 assert.match(html,/CookbookPersonalCloud\.start\(/);
 assert.match(html,/CookbookPersonalCloud\.changed\(\)/);
 assert.match(html,/function applyPersonalCloudData\(/);
 assert.match(html,/const BACKUP_FIELDS=\['favorites','ingredientChecks','basket','basketChecks','notes','cookProgress'\]/);
 assert.match(sw,/personal-cloud\.js/);
 assert.match(schema,/alter table public\.cookbook_personal_data enable row level security/i);
 assert.match(schema,/user_id = \(select auth\.uid\(\)\)/i);
});
