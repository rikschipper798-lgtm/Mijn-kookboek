'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const script=path.resolve(__dirname,'../scripts/backup-database.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cookbook-db-backup-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const input=path.join(dir,'dummy-data.dump');
 const output=path.join(dir,'dummy-data.mkbak');
 const recovered=path.join(dir,'recovered.dump');
 const secret=crypto.randomBytes(32).toString('base64');
 const env={...process.env,BACKUP_ENCRYPTION_KEY_BASE64:secret};
 fs.writeFileSync(input,crypto.randomBytes(1024*1024+17),{mode:0o600});
 return {input,output,recovered,env,dir};
}
function run(args,env){return spawnSync(process.execPath,[script,...args],{env,encoding:'utf8',timeout:20000});}

test('De versleutelde dump kan worden gecontroleerd en volledig worden teruggezet',t=>{
 const x=fixture(t);
 let r=run(['encrypt',x.input,x.output],x.env);assert.equal(r.status,0,r.stderr);
 assert.equal(fs.readFileSync(x.output).subarray(0,6).toString(),'MKDBK1');
 assert.notDeepEqual(fs.readFileSync(x.output).subarray(18,50),fs.readFileSync(x.input).subarray(0,32));
 r=run(['verify',x.output],x.env);assert.equal(r.status,0,r.stderr);
 r=run(['decrypt',x.output,x.recovered],x.env);assert.equal(r.status,0,r.stderr);
 assert.deepEqual(fs.readFileSync(x.recovered),fs.readFileSync(x.input));
});
test('Een onjuiste sleutel kan de dump niet ontsleutelen',t=>{
 const x=fixture(t);
 assert.equal(run(['encrypt',x.input,x.output],x.env).status,0);
 const wrong={...x.env,BACKUP_ENCRYPTION_KEY_BASE64:crypto.randomBytes(32).toString('base64')};
 const r=run(['decrypt',x.output,x.recovered],wrong);
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/Integriteitscontrole/);
 assert.equal(fs.existsSync(x.recovered),false);
});
test('Gemanipuleerde ciphertext wordt gedetecteerd',t=>{
 const x=fixture(t);assert.equal(run(['encrypt',x.input,x.output],x.env).status,0);
 const contents=fs.readFileSync(x.output);
 contents[160]^=0x01;
 fs.writeFileSync(x.output,contents);
 const result=run(['verify',x.output],x.env);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Integriteitscontrole/);
});
test('Een bestaand uitvoerbestand wordt nooit overschreven of verwijderd',t=>{
 const x=fixture(t);
 fs.writeFileSync(x.output,'BEHOUD DIT BESTAND');
 const r=run(['encrypt',x.input,x.output],x.env);
 assert.notEqual(r.status,0);
 assert.equal(fs.readFileSync(x.output,'utf8'),'BEHOUD DIT BESTAND');
});
test('Een bestaande ontvanger blijft staan als ontsleutelen geweigerd wordt',t=>{
 const x=fixture(t);
 assert.equal(run(['encrypt',x.input,x.output],x.env).status,0);
 fs.writeFileSync(x.recovered,'BEHOUD RECOVERED');
 const r=run(['decrypt',x.output,x.recovered],x.env);
 assert.notEqual(r.status,0);
 assert.equal(fs.readFileSync(x.recovered,'utf8'),'BEHOUD RECOVERED');
});
test('De sleutelwaarde is verplicht en moet precies 32 bytes zijn',t=>{
 const x=fixture(t);
 const invalid={...x.env,BACKUP_ENCRYPTION_KEY_BASE64:'test'};
 const r=run(['encrypt',x.input,x.output],invalid);
 assert.notEqual(r.status,0);
 assert.equal(fs.existsSync(x.output),false);
});
test('Onvolledige dumps worden geweigerd',t=>{
 const x=fixture(t);
 fs.writeFileSync(x.output,'MKDBK1kort');
 const r=run(['verify',x.output],x.env);
 assert.notEqual(r.status,0);
});
