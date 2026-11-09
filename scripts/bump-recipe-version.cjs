#!/usr/bin/env node
'use strict';
// Gebruik na een inhoudelijke wijziging; pas recept en revisiegegevens toe
// vóórdat recepten.json als één wijziging wordt gecommit.
const fs=require('node:fs'),path=require('node:path');
const {validateRecipes}=require('./validate-recipes.cjs');
function dateValid(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const d=new Date(value+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function todayAmsterdam(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',
  month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const field=name=>parts.find(p=>p.type===name)?.value;
 return field('year')+'-'+field('month')+'-'+field('day');
}
function bumpRecipe(data,recipeId,description,options={}){
 if(!Array.isArray(data))throw Error('Receptenbestand is geen lijst.');
 const recipe=data.find(r=>r.id===recipeId);
 if(!recipe)throw Error('Recept bestaat niet: '+recipeId);
 const variantId=options.variantId||null;
 const target=variantId?(recipe.variants||[]).find(v=>v.id===variantId):recipe;
 if(!target)throw Error('Variant bestaat niet: '+variantId);
 const message=String(description||'').trim();
 if(message.length<8||message.length>400)throw Error('Beschrijf de wijziging in 8 tot 400 tekens.');
 const date=options.date||todayAmsterdam();
 if(!dateValid(date))throw Error('Gebruik een echte datum in YYYY-MM-DD.');
 if(!Number.isInteger(target.version)||target.version<1||
    !Array.isArray(target.changeLog)||
    target.changeLog.length!==target.version-1+(target.changeLog[0]?.version===1?1:0))
  throw Error('Revisiegegevens zijn onvolledig of inconsistent.');
 if(date<recipe.date||target.updatedAt&&date<target.updatedAt)
  throw Error('Wijzigingsdatum mag niet vóór de opnamedatum of vorige wijziging vallen.');
 const version=target.version+1;
 target.version=version;
 target.updatedAt=date;
 target.changeLog.push({version,date,description:message});
 return {id:recipeId,variantId,version,date,description:message};
}
function usage(){
 return 'Gebruik:\n'+
  '  node scripts/bump-recipe-version.cjs <recept-id> "<korte wijziging>" [--variant=variant-id] [--date=YYYY-MM-DD]\n'+
  'Wijzig eerst de receptinhoud. Pas versie en inhoud samen aan vóór het committen.';
}
if(require.main===module){
 try{
  const [id,message,...extra]=process.argv.slice(2);
  if(!id||!message||extra.some(x=>!/^--(?:variant|date)=.+$/.test(x)))
   throw Error(usage());
  const variantOption=extra.find(x=>x.startsWith('--variant='));
  const dateOption=extra.find(x=>x.startsWith('--date='));
  const options={
   variantId:variantOption?variantOption.slice('--variant='.length):null,
   date:dateOption?dateOption.slice('--date='.length):undefined
  };
  const root=path.resolve(__dirname,'..');
  const filename=path.join(root,'recepten.json');
  const data=JSON.parse(fs.readFileSync(filename,'utf8'));
  const revision=bumpRecipe(data,id,message,options);
  const result=validateRecipes(data,{rootDir:root});
  if(result.errors.length)throw Error('Validatie mislukt:\n'+result.errors.join('\n'));
  fs.writeFileSync(filename,JSON.stringify(data,null,2)+'\n','utf8');
  console.log('Versie '+revision.version+' geregistreerd voor '+id+
   (revision.variantId?' ('+revision.variantId+')':'')+' op '+revision.date+'.');
 }catch(e){console.error('FOUT:',e.message);process.exitCode=1;}
}
module.exports={bumpRecipe,todayAmsterdam};
