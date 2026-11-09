'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const code=fs.readFileSync(path.join(root,'voeding-cloud.js'),'utf8');
const app=fs.readFileSync(path.join(root,'voeding.html'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/schema.sql'),'utf8');
const makeData=kcal=>({goals:{kcal:2300},days:{"2026-11-09":[{title:'Test',nutrition:{kcal}}]},weekdayPresets:{},weekdayApplied:{}});

function database(){
 const rows=new Map();
 return {
  rows,
  from(table){
   assert.equal(table,'nutrition_diaries');
   let action='select',payload=null,filters={};
   const builder={
    select(){return builder;},
    eq(key,value){filters[key]=value;return builder;},
    insert(input){action='insert';payload=input;return builder;},
    update(input){action='update';payload=input;return builder;},
    async maybeSingle(){
     const row=rows.get(filters.user_id);
     if(action==='select')return {data:row?{diary:row.diary,revision:row.revision}:null,error:null};
     if(!row||row.revision!==filters.revision)return {data:null,error:null};
     const next={...row,...payload};rows.set(filters.user_id,next);
     return {data:{revision:next.revision},error:null};
    },
    async single(){
     if(action!=='insert')throw Error('Unexpected single()');
     if(rows.has(payload.user_id))return {data:null,error:{code:'23505',message:'duplicate'}};
     rows.set(payload.user_id,{...payload});
     return {data:{revision:payload.revision},error:null};
    }
   };
   return builder;
  }
 };
}
function harness(db,account,{local=null}={}){
 const elements={};
 function element(id){
  if(!elements[id])elements[id]={
   id,value:'',hidden:false,disabled:false,textContent:'',
   classList:{toggle(){}},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},
   checkValidity(){return true;},click(){if(this.onclick)this.onclick();}
  };
  return elements[id];
 }
 const document={
  getElementById:element,
  addEventListener(){},
  head:{appendChild(){throw Error('Cloud SDK should be preloaded in test')}}
 };
 const client={
  from:key=>db.from(key),
  auth:{
   onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
   async getSession(){return {data:{session:{user:account}},error:null};},
   async signOut(){return {error:null};},
   async signInWithOtp(){return {error:null};}
  }
 };
 const window={
  COOKBOOK_CLOUD_CONFIG:{
   url:'https://kookboek-test.supabase.co',publishableKey:'sb_publishable_example_test_key_for_javascript'
  },
  supabase:{createClient(){return client;}},
  addEventListener(){},
  confirm(){return true;}
 };
 const callbacks={
  onData(v){callbacks.current=v;},
  onLogout(){callbacks.current=null;},
  getLocal(){return local;},
  getState(){return callbacks.current;},
  hasLocal(){return !!local;},
  current:null
 };
 const context={
  window,document,location:{origin:'https://example.com',pathname:'/voeding.html'},
  setTimeout:fn=>setTimeout(fn,0),clearTimeout,console,Date,JSON,Error,Promise
 };
 vm.runInNewContext(code,context,{filename:'voeding-cloud.js',timeout:1000});
 return {cloud:window.CookbookCloud,callbacks,elements,async start(){
  await window.CookbookCloud.start(callbacks);
 },async save(data){
  callbacks.current=data;
  window.CookbookCloud.enqueue(data);
  await new Promise(resolve=>setTimeout(resolve,30));
 }};
}

test('Cloudaccounts bevatten geen geheime sleutels en zijn standaard uitgeschakeld',()=>{
 const config=fs.readFileSync(path.join(root,'cloud-config.js'),'utf8');
 assert.match(config,/publishableKey:\s*""/);
 assert.doesNotMatch(config,/service_role\s*:\s*['"]/i);
 assert.match(app,/cloudMode/);
 assert.match(app,/cloudReady/);
 assert.match(app,/voeding-cloud\.js/);
 assert.match(app,/cloud-config\.js/);
});
test('RLS geeft uitsluitend toegang tot de eigen profielrij',()=>{
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/to authenticated/i);
 assert.match(sql,/with check \(user_id = \(select auth\.uid\(\)\)\)/i);
 assert.match(sql,/using \(user_id = \(select auth\.uid\(\)\)\)/i);
 assert.match(sql,/revoke all on table public\.nutrition_diaries from anon/i);
});
test('Twee verschillende gebruikers synchroniseren gescheiden dagboeken',async()=>{
 const db=database();
 const personA={id:'11111111-1111-4111-8111-111111111111',email:'a@example.org'};
 const personB={id:'22222222-2222-4222-8222-222222222222',email:'b@example.org'};
 const a=harness(db,personA),b=harness(db,personB);
 await a.start();
 await a.save(makeData(420));
 assert.equal(db.rows.get(personA.id).diary.days['2026-11-09'][0].nutrition.kcal,420);
 await b.start();
 assert.equal(b.callbacks.current,null);
 await b.save(makeData(590));
 assert.equal(db.rows.size,2);
 assert.equal(db.rows.get(personA.id).diary.days['2026-11-09'][0].nutrition.kcal,420);
 assert.equal(db.rows.get(personB.id).diary.days['2026-11-09'][0].nutrition.kcal,590);
});
test('Twee apparaten van hetzelfde account overschrijven elkaar niet stilzwijgend',async()=>{
 const db=database();
 const person={id:'33333333-3333-4333-8333-333333333333',email:'same@example.org'};
 const first=harness(db,person);
 await first.start();
 await first.save(makeData(300)); // rev 1
 const second=harness(db,person);
 await second.start(); // rev 1
 await first.save(makeData(480)); // rev 2
 await second.save(makeData(920)); // conflict
 assert.equal(db.rows.get(person.id).revision,2);
 assert.equal(db.rows.get(person.id).diary.days['2026-11-09'][0].nutrition.kcal,480);
 assert.match(second.elements.cloudStatus.textContent,/ander apparaat gewijzigd/);
});
test('Oude lokale dagboekgegevens verhuizen alleen na expliciete instemming',async()=>{
 const db=database(),person={id:'44444444-4444-4444-8444-444444444444',email:'migrate@example.org'};
 const old=makeData(780);
 const browser=harness(db,person,{local:old});
 await browser.start();
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(db.rows.get(person.id).diary.days['2026-11-09'][0].nutrition.kcal,780);
});
