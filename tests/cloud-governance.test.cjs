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
