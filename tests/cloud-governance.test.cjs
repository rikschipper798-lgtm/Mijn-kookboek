'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=rel=>fs.readFileSync(path.resolve(__dirname,'..',rel),'utf8');
const html=read('voeding.html');
const cloud=read('voeding-cloud.js');
const accountFn=read('supabase/functions/delete-my-account/index.ts');
const history=read('supabase/history.sql');
const evolution=read('supabase/schema-evolution.sql');

test('Zelfverwijdering is beschermd met tokens en dubbele bevestiging',()=>{
 assert.match(accountFn,/request\.headers\.get\("authorization"\)/);
 assert.match(accountFn,/verifier\.auth\.getUser\(token\)/);
 assert.match(accountFn,/admin\.auth\.admin\.deleteUser\(data\.user\.id\)/);
 assert.match(accountFn,/confirmation!=="VERWIJDER"/);
 assert.match(accountFn,/requestingOrigin!==origin/);
 assert.match(cloud,/window\.prompt\(/);
 assert.match(cloud,/window\.confirm\('Laatste bevestiging/);
 assert.match(cloud,/functions\.invoke\('delete-my-account'/);
 assert.doesNotMatch(cloud,/sb_secret_[a-zA-Z0-9]+/);
});
test('Versiegeschiedenis is beveiligd en begrensd tot drie snapshots',()=>{
 assert.match(history,/enable row level security/);
 assert.match(history,/grant select on table public\.nutrition_diary_history to authenticated/);
 assert.match(history,/user_id=\(select auth\.uid\(\)\)/);
 assert.match(history,/revoke all privileges on table public\.nutrition_diary_history from anon,authenticated,public/);
 assert.match(history,/limit 3/);
 assert.match(history,/security definer/);
 assert.match(history,/set search_path = ''/);
 assert.match(history,/revoke all on schema app_private from public, anon, authenticated/);
});
test('Herstellen van eerdere versies gebruikt dezelfde accountgebonden opslag',()=>{
 assert.match(html,/id="cloudHistorySelect"/);
 assert.match(html,/id="cloudHistoryRestore"/);
 assert.match(html,/restoreVersion\(data\)[\s\S]*?return commit\(/);
 assert.match(cloud,/from\('nutrition_diary_history'\)/);
 assert.match(cloud,/eq\('user_id',account\)/);
 assert.match(cloud,/hooks\.restoreVersion\(validated\)/);
 assert.match(cloud,/if\(!user\|\|!ready\|\|draft\|\|sending\|\|conflict\)/);
});
test('Database bevat schema-versie en minimaal geldig JSON-dagboek',()=>{
 assert.match(evolution,/schema_version smallint not null default 1/);
 assert.match(evolution,/jsonb_typeof\(diary->'goals'\) = 'object'/);
 assert.match(evolution,/jsonb_typeof\(diary->'days'\) = 'object'/);
});
test('Privacy-uitleg beschrijft persoonlijke opslag en de beperking van browserback-ups',()=>{
 const page=read('privacy.html');
 assert.match(page,/Supabase/);
 assert.match(page,/lokale herstelkopie/);
 assert.match(page,/Exporteer dagboek/);
 assert.match(page,/verwijder/);
 assert.match(html,/href="\.\/privacy\.html"/);
});

test('Directe instelpagina verwijst na controle naar voedingsdagboek zonder zelf te schrijven',()=>{
 const page=read('instellen-vaste-maaltijden.html');
 const match=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match);
 const values={
  app:'mijn-kookboek-vaste-maaltijden',version:1,
  weekdayPresets:{
   ontbijt:{title:'Twee boterhammen',enabled:true,startDate:'2026-11-09',nutrition:{kcal:276,proteinG:10,carbsG:37.1,fatG:8.1,fiberG:6.2}},
   lunch:{title:'Vier boterhammen',enabled:true,startDate:'2026-11-09',nutrition:{kcal:516,proteinG:19,carbsG:64.8,fatG:17.6,fiberG:11}}
  }
 };
 const nodes={};let redirected=null;
 const el=id=>nodes[id]??={textContent:'',disabled:true,innerHTML:'',classList:{toggle(){}},onclick:null};
 const location={
  hash:'#gegevens='+encodeURIComponent(JSON.stringify(values)),
  assign(url){redirected=url;}
 };
 const vm=require('node:vm');
 vm.runInNewContext(match[1],{document:{getElementById:el},location,Date,JSON,Error,Number,String},{timeout:1500});
 assert.equal(el('apply').disabled,false);
 el('apply').onclick();
 assert.match(redirected,/^\.\/voeding\.html#vaste-maaltijden=/);
 const forwarded=JSON.parse(decodeURIComponent(redirected.split('=')[1]));
 assert.equal(forwarded.weekdayPresets.ontbijt.nutrition.kcal,276);
 assert.equal(forwarded.weekdayPresets.lunch.nutrition.kcal,516);
});

test('Dagboek wijst te grote nieuwe wijzigingen af vóór cloudupload',()=>{
 const inline=html.match(/<script>\s*'use strict';[\s\S]*?<\/script>/);
 assert.ok(inline);
 const vm=require('node:vm');
 const entries=Array.from({length:100},(_,i)=>({
  id:'line-'+i,title:'A'.repeat(200),source:'manual',
  nutrition:{kcal:100,proteinG:10,carbsG:15,fatG:5,fiberG:2}
 }));
 const days={};
 for(let i=0;i<75;i++){
  const date=new Date('2026-01-01T12:00:00Z');date.setUTCDate(date.getUTCDate()+i);
  days[date.toISOString().slice(0,10)]=entries;
 }
 const oversized={goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
  days,weekdayPresets:{},weekdayApplied:{}};
 let cloudWrites=0;const elements={},events={};
 const el=id=>elements[id]??={value:'',checked:false,disabled:false,hidden:false,
  style:{},innerHTML:'',textContent:'',dataset:{},classList:{
   values:new Set(),
   toggle(name,force){const on=force??!this.values.has(name);if(on)this.values.add(name);else this.values.delete(name);return on;},
   contains(name){return this.values.has(name);}
  },
  setAttribute(){},addEventListener(k,fn){(events[id]??={})[k]=fn;},
  focus(){},reset(){}};
 const sandbox={
  window:{CookbookCloud:{enabled:true,start(callbacks){callbacks.onData(oversized)},
   enqueue(){cloudWrites++;return true;}},confirm(){return true;}},
  document:{getElementById:el},location:{search:'',hash:''},
  localStorage:{getItem(){return null},setItem(){}},
  fetch:async()=>({ok:true,json:async()=>[]}),URLSearchParams,Date,Math,JSON,Error,Promise,Number,String,
  setTimeout(){return 0;}
 };
 vm.runInNewContext(inline[0].replace(/^<script>/,'').replace(/<\/script>$/,''),sandbox,{timeout:4000});
 el('manualName').value='Nog een maaltijd';
 el('manualKcal').value='200';
 for(const id of ['manualProtein','manualCarbs','manualFat','manualFiber'])el(id).value='';
 events.manualForm.submit({preventDefault(){}});
 assert.equal(cloudWrites,0);
 assert.match(el('status').textContent,/opslaglimiet/);
 assert.match(el('storageCapacity').textContent,/Dagboekgrootte/);
});
