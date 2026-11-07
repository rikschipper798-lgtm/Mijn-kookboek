#!/usr/bin/env node
'use strict';
// Controleer bij elke wijziging dat recepten en varianten een revisie krijgen.
// Nieuwe recepten beginnen op v1. Revisies bevatten een nieuwe datum en logregel.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
function contentView(r){
 const value={...r};
 for(const k of ['version','updatedAt','changeLog','variants'])delete value[k];
 return value;
}
function views(recipes){
 const result=new Map();
 for(const r of recipes){
  result.set(r.id,{meta:r,content:contentView(r)});
  for(const v of r.variants||[])
   result.set(r.id+'::'+v.id,{meta:v,content:contentView({...r,...v})});
 }
 return result;
}
function checkChanges(previous,current){
 const old=views(previous),now=views(current),errors=[];
 for(const [key,item] of now){
  const before=old.get(key),newMeta=item.meta;
  if(!before){
   if(newMeta.version!==1||newMeta.updatedAt!==null||
      !Array.isArray(newMeta.changeLog)||newMeta.changeLog.length)
    errors.push(key+': nieuw recept of variant moet beginnen op versie 1 zonder eerdere wijzigingen.');
   continue;
  }
  const changed=JSON.stringify(stable(before.content))!==JSON.stringify(stable(item.content));
  const oldVersion=Number.isInteger(before.meta.version)?before.meta.version:1;
  const oldHistory=Array.isArray(before.meta.changeLog)?before.meta.changeLog:[];
  const nextVersion=oldVersion+(changed?1:0);
  if(newMeta.version!==nextVersion)
   errors.push(key+': '+(changed?'inhoud veranderd: verhoog versienummer van '+oldVersion+' naar '+nextVersion:
    'inhoud niet veranderd: laat versie op '+oldVersion)+' staan.');
  if(!Array.isArray(newMeta.changeLog))continue;
  if(newMeta.changeLog.length!==oldHistory.length+(changed?1:0))
   errors.push(key+': wijzigingsgeschiedenis moet '+(changed?'exact één nieuwe regel hebben':'ongewijzigd blijven')+'.');
  if(JSON.stringify(stable(newMeta.changeLog.slice(0,oldHistory.length)))!==JSON.stringify(stable(oldHistory)))
   errors.push(key+': bestaande wijzigingsregels mogen niet worden aangepast.');
  if(changed){
   const last=newMeta.changeLog.at(-1);
   if(!last||last.version!==nextVersion||last.date!==newMeta.updatedAt||!last.description?.trim())
    errors.push(key+': registreer versie '+nextVersion+' met wijzigingsdatum en omschrijving.');
   if(before.meta.updatedAt&&newMeta.updatedAt<before.meta.updatedAt)
    errors.push(key+': wijzigingsdatum mag niet teruglopen.');
  }else{
   const previousDate=before.meta.updatedAt===undefined?null:before.meta.updatedAt;
   if(newMeta.updatedAt!==previousDate)
    errors.push(key+': wijzigingsdatum mag niet veranderen zonder inhoudelijke wijziging.');
  }
 }
 return errors;
}
if(require.main===module){
 try{
  const base=path.resolve(__dirname,'..');
  const before=JSON.parse(execFileSync('git',['show','HEAD^:recepten.json'],{
   cwd:base,encoding:'utf8',maxBuffer:5*1024*1024
  }));
  const after=JSON.parse(fs.readFileSync(path.join(base,'recepten.json'),'utf8'));
  const errors=checkChanges(before,after);
  errors.forEach(x=>console.error('FOUT:',x));
  if(errors.length){console.error('AFGEKEURD:',errors.length,'revisiefouten.');process.exitCode=1;}
  else console.log('GESLAAGD: elke inhoudelijke receptwijziging heeft de juiste versie en wijzigingsdatum.');
 }catch(e){
  console.error('FOUT: vergelijking met vorige Git-revisie mislukt:',e.message);
  process.exitCode=1;
 }
}
module.exports={checkChanges};
