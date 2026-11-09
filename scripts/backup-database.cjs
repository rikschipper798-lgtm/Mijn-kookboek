#!/usr/bin/env node
'use strict';
// Encrypted, off-site-capable PostgreSQL dump format. The key is never written
// to the backup or repository. A dump may contain authentication secrets.
const fs=require('node:fs');
const crypto=require('node:crypto');
const {Transform,Writable}=require('node:stream');
const {pipeline}=require('node:stream/promises');

const MAGIC=Buffer.from('MKDBK1','ascii');
const IV_BYTES=12, TAG_BYTES=16, HEADER_BYTES=MAGIC.length+IV_BYTES;

function keyFromEnv(){
  const input=process.env.BACKUP_ENCRYPTION_KEY_BASE64||'';
  if(!/^[A-Za-z0-9+/]{43}=$/.test(input))
    throw Error('Ontbrekende of ongeldige BACKUP_ENCRYPTION_KEY_BASE64 (exact 32 willekeurige bytes als base64).');
  const key=Buffer.from(input,'base64');
  if(key.length!==32||key.toString('base64')!==input)
    throw Error('De encryptiesleutel moet precies 32 bytes zijn.');
  return key;
}
function readHeader(file){
  const info=fs.statSync(file);
  if(info.size<HEADER_BYTES+TAG_BYTES+1)throw Error('Back-upbestand is te klein.');
  const fd=fs.openSync(file,'r');
  try{
    const head=Buffer.alloc(HEADER_BYTES),tag=Buffer.alloc(TAG_BYTES);
    if(fs.readSync(fd,head,0,head.length,0)!==head.length)throw Error('Onvolledige back-upheader.');
    if(!head.subarray(0,MAGIC.length).equals(MAGIC))throw Error('Onbekend back-upformaat.');
    if(fs.readSync(fd,tag,0,tag.length,info.size-TAG_BYTES)!==tag.length)throw Error('Onvolledige authenticatietag.');
    return {iv:head.subarray(MAGIC.length),tag,end:info.size-TAG_BYTES-1};
  }finally{fs.closeSync(fd);}
}
async function encrypt(input,output){
  if(input!=='-'&&!fs.existsSync(input))throw Error('Het invoerbestand bestaat niet.');
  const key=keyFromEnv(),iv=crypto.randomBytes(IV_BYTES);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const tagAppender=new Transform({
    transform(chunk,encoding,done){done(null,chunk);},
    flush(done){this.push(cipher.getAuthTag());done();}
  });
  const target=fs.createWriteStream(output,{fd:fs.openSync(output,'wx',0o600),autoClose:true});
  target.write(MAGIC);target.write(iv);
  try{
    await pipeline(input==='-'?process.stdin:fs.createReadStream(input),cipher,tagAppender,target);
  }catch(error){
    fs.rmSync(output,{force:true});
    throw error;
  }
}
async function openBackup(input,output){
  const key=keyFromEnv(),{iv,tag,end}=readHeader(input);
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAuthTag(tag);
  const source=fs.createReadStream(input,{start:HEADER_BYTES,end});
  const sink=output?fs.createWriteStream(output,{fd:fs.openSync(output,'wx',0o600),autoClose:true}):
    new Writable({write(chunk,encoding,done){done();}});
  try{
    await pipeline(source,decipher,sink);
  }catch(error){
    if(output)fs.rmSync(output,{force:true});
    throw Error('Integriteitscontrole mislukt: verkeerde sleutel of gewijzigd back-upbestand.');
  }
}
async function main(){
  const [command,input,output]=process.argv.slice(2);
  if(command==='encrypt'&&input&&output){
    await encrypt(input,output);
    console.log('Versleutelde back-up aangemaakt.');
  }else if(command==='verify'&&input&&!output){
    await openBackup(input,null);
    console.log('Encryptie en integriteit gecontroleerd.');
  }else if(command==='decrypt'&&input&&output){
    await openBackup(input,output);
    console.log('Back-up ontsleuteld naar lokaal bestand. Beveilig de inhoud.');
  }else{
    throw Error('Gebruik: encrypt <bestand of -> <doel.mkbak>, verify <doel.mkbak>, decrypt <doel.mkbak> <uitvoerbestand>.');
  }
}
if(require.main===module){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={encrypt,openBackup,readHeader};
