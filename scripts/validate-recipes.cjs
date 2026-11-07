#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const UNITS=new Set('g|kg|ml|l|tl|el|stuk|stuks|teentje|teentjes|snee|snufje|klein snufje|plakken|blad|blaadjes|plantje|schijfjes|bolletjes|grote|naar smaak'.split('|'));
const TIME_KEYS='minutes prep cook marinateMinutes restMinutes activeMinutes optionalWaitMinMinutes optionalWaitMaxMinutes initialRestMinutes coldRiseMinutes coldRiseMinimumMinutes coldRiseRecommendedMinMinutes coldRiseRecommendedMaxMinutes benchRestMinutes finalProofMinutes finalProofMinMinutes finalProofMaxMinutes coolMinutes'.split(' ');
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMG=/^images\/[a-zA-Z0-9_./-]+\.(webp|avif|png|jpg|jpeg|svg)$/i;
function validateRecipes(data,{rootDir=path.resolve(__dirname,'..'),existsFile=(f)=>fs.existsSync(path.join(rootDir,f))}={}){
 const errors=[],warnings=[],seenIds=new Map();
 const fail=(p,m)=>errors.push(p+': '+m),warn=(p,m)=>warnings.push(p+': '+m);
 const isText=x=>typeof x==='string'&&x.trim().length>0;
 const required=(obj,k,p)=>{if(!isText(obj[k]))fail(p+'.'+k,'verplicht niet-leeg tekstveld');};
 const date=v=>{
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;
 };
 const id=(v,p)=>{
  if(!isText(v)||!ID.test(v)){fail(p,'ongeldige ID');return;}
  if(seenIds.has(v))fail(p,'dubbele ID of alias '+v);
  else seenIds.set(v,p);
 };
 const image=(v,p)=>{
  if(!isText(v.image)){fail(p+'.image','afbeelding ontbreekt');return;}
  if(!IMG.test(v.image)||v.image.includes('//')||v.image.split('/').includes('..'))fail(p+'.image','ongeldig afbeeldingspad');
  else if(!existsFile(v.image))fail(p+'.image','afbeelding bestaat niet: '+v.image);
  required(v,'image_source',p);
 };
 function time(r,p){
  for(const k of TIME_KEYS)if(r[k]!==undefined&&(!Number.isInteger(r[k])||r[k]<0))fail(p+'.'+k,'minuten moeten een niet-negatief geheel getal zijn');
  for(const k of ['minutes','prep','cook'])if(r[k]===undefined)fail(p+'.'+k,'tijd ontbreekt');
  if(r.minutes!==undefined&&r.minutes<=0)fail(p+'.minutes','moet groter dan nul zijn');
  if(Number.isFinite(r.minutes)&&Number.isFinite(r.prep)&&Number.isFinite(r.cook)){
   if(r.minutes<Math.max(r.prep,r.cook))fail(p+'.minutes','totaal korter dan afzonderlijke fase');
   if(r.minutes-r.prep-r.cook>10&&!isText(r.timeNote)&&!r.coldRiseMinutes)warn(p+'.minutes','wachttijd zonder toelichting');
  }
  for(const [num,timing] of [['marinateMinutes','marinateTiming'],['restMinutes','restTiming']]){
   if(r[num]>0&&!['included','parallel','optional'].includes(r[timing]))fail(p+'.'+timing,'kies included, parallel of optional');
  }
  if((r.optionalWaitMinMinutes||0)>(r.optionalWaitMaxMinutes||0))fail(p+'.optionalWaitMaxMinutes','maximum kleiner dan minimum');
  if(r.optionalWaitMaxMinutes>0&&!isText(r.optionalWaitType))fail(p+'.optionalWaitType','type optionele wachttijd ontbreekt');
  if(r.coldRiseMinutes>0){
   const sum=['prep','initialRestMinutes','coldRiseMinutes','benchRestMinutes','finalProofMinutes','cook','coolMinutes'].reduce((n,k)=>n+(r[k]||0),0);
   if(r.minutes!==sum)fail(p+'.minutes','rijs- en rusttijden tellen op tot '+sum+', niet '+r.minutes);
  }
 }
 function contents(r,p){
  const ingredients=r.ingredients,steps=r.steps,used=new Set(),names=new Set();
  if(!Array.isArray(ingredients)||!ingredients.length)fail(p+'.ingredients','minimaal één ingrediënt vereist');
  if(!Array.isArray(steps)||!steps.length)fail(p+'.steps','minimaal één bereidingsstap vereist');
  if(Array.isArray(ingredients))ingredients.forEach((i,j)=>{
   const loc=p+'.ingredients['+j+']';
   if(!i||typeof i!=='object'||Array.isArray(i)){fail(loc,'ongeldig ingrediëntobject');return;}
   for(const k of ['name','unit','group'])required(i,k,loc);
   if(isText(i.unit)&&!UNITS.has(i.unit))fail(loc+'.unit','onbekende eenheid '+i.unit);
   if(i.qty===null){if(i.unit!=='naar smaak')fail(loc+'.qty','null alleen bij naar smaak');}
   else if(typeof i.qty!=='number'||!Number.isFinite(i.qty)||i.qty<=0)fail(loc+'.qty','positief getal vereist');
   if(i.optional!==undefined&&typeof i.optional!=='boolean')fail(loc+'.optional','true/false vereist');
   if(i.scaleRoundTo!==undefined){
    if(!Number.isInteger(i.scaleRoundTo)||i.scaleRoundTo<=0)fail(loc+'.scaleRoundTo','positief geheel getal vereist');
    else if(typeof i.qty!=='number'||Math.abs(i.qty/i.scaleRoundTo-Math.round(i.qty/i.scaleRoundTo))>1e-8)fail(loc+'.scaleRoundTo','hoeveelheid niet deelbaar door afrondstap');
   }
   const key=String(i.group).toLowerCase()+'/'+String(i.name).toLowerCase();
   if(names.has(key))warn(loc,'dubbel ingrediënt in groep');
   names.add(key);
  });
  if(Array.isArray(steps))steps.forEach((step,j)=>{
   const loc=p+'.steps['+j+']';
   if(!step||typeof step!=='object'||Array.isArray(step)){fail(loc,'ongeldig stapobject');return;}
   required(step,'title',loc);required(step,'body',loc);
   if(step.duration!==undefined&&!isText(step.duration))fail(loc+'.duration','lege tijdsaanduiding');
   if(!Array.isArray(step.ingredientIndices))fail(loc+'.ingredientIndices','ingrediëntverwijzingen ontbreken');
   else{
    const local=new Set();
    step.ingredientIndices.forEach((index,k)=>{
     if(!Number.isInteger(index)||index<0||!Array.isArray(ingredients)||index>=ingredients.length)fail(loc+'.ingredientIndices['+k+']','ongeldige ingrediëntindex');
     else{if(local.has(index))fail(loc+'.ingredientIndices['+k+']','dubbele ingrediëntverwijzing');local.add(index);used.add(index);}
    });
   }
   for(const flag of ['scaleEggMixture','scaleServingSummary'])if(step[flag]!==undefined&&typeof step[flag]!=='boolean')fail(loc+'.'+flag,'true/false vereist');
  });
  if(Array.isArray(ingredients))ingredients.forEach((i,j)=>{
   if(i&&isText(i.name)&&!used.has(j))warn(p+'.ingredients['+j+']','ingrediënt '+i.name+' niet gekoppeld aan een stap');
  });
  if(r.tips===undefined||!(isText(r.tips)||(Array.isArray(r.tips)&&r.tips.every(isText))))fail(p+'.tips','verwacht tiptekst of lijst tipteksten; lege lijst mag');
 }
 if(!Array.isArray(data)||!data.length){
  fail('recepten.json','verwacht niet-lege receptenlijst');
  return {errors,warnings,stats:{recipes:0,variants:0,images:0}};
 }
 let variants=0,images=0;
 data.forEach((r,j)=>{
  const loc='recepten['+j+']';
  if(!r||typeof r!=='object'||Array.isArray(r)){fail(loc,'ongeldig receptobject');return;}
  id(r.id,loc+'.id');
  if(r.aliases!==undefined){
   if(!Array.isArray(r.aliases))fail(loc+'.aliases','lijst vereist');
   else r.aliases.forEach((x,k)=>id(x,loc+'.aliases['+k+']'));
  }
  for(const k of ['title','subtitle','category','kind','cuisine','servingUnit','heat','difficulty'])required(r,k,loc);
  if(!date(r.date))fail(loc+'.date','ongeldige datum YYYY-MM-DD');
  if(!Array.isArray(r.tags)||!r.tags.length||r.tags.some(t=>!isText(t)))fail(loc+'.tags','niet-lege lijst tags vereist');
  else if(new Set(r.tags.map(t=>t.trim().toLowerCase())).size!==r.tags.length)fail(loc+'.tags','dubbele tags');
  if(!Number.isInteger(r.servings)||r.servings<=0)fail(loc+'.servings','positief geheel aantal porties vereist');
  for(const flag of ['featured','totalTimeEstimated'])if(r[flag]!==undefined&&typeof r[flag]!=='boolean')fail(loc+'.'+flag,'true/false vereist');
  time(r,loc);image(r,loc);images++;contents(r,loc);
  if(r.variants!==undefined){
   if(!Array.isArray(r.variants)||!r.variants.length)fail(loc+'.variants','niet-lege variantenlijst vereist');
   else{
    const seen=new Set();
    r.variants.forEach((v,k)=>{
     const p=loc+'.variants['+k+']';
     if(!v||typeof v!=='object'||Array.isArray(v)){fail(p,'ongeldige variant');return;}
     if(!isText(v.id)||!ID.test(v.id))fail(p+'.id','ongeldige variant-ID');
     else if(seen.has(v.id)||v.id===r.id)fail(p+'.id','dubbele variant-ID');
     seen.add(v.id);required(v,'label',p);
     const merged={...r,...v};time(merged,p);contents(merged,p);
     if(v.image!==undefined){
      image({...merged,image_source:v.image_source||r.image_source},p);images++;
      if(v.image!==r.image&&!isText(v.image_source))fail(p+'.image_source','eigen herkomst voor variantafbeelding vereist');
     }
     variants++;
    });
   }
  }
 });
 const byRecipeId=new Map(data.filter(r=>r&&typeof r.id==='string').map(r=>[r.id,r]));
 const dependencyGraph=new Map();
 data.forEach((r,index)=>{
  if(!r||typeof r!=='object'||Array.isArray(r))return;
  const loc='recepten['+index+']';
  if(r.outputQty!==undefined||r.outputUnit!==undefined){
   if(typeof r.outputQty!=='number'||!Number.isFinite(r.outputQty)||r.outputQty<=0)
    fail(loc+'.outputQty','opbrengst moet een positief getal zijn');
   if(!isText(r.outputUnit)||!UNITS.has(r.outputUnit))
    fail(loc+'.outputUnit','opbrengst moet een ondersteunde eenheid hebben');
  }
  const dependencies=new Set();
  for(const [view,p] of [[r,loc],...(Array.isArray(r.variants)?r.variants.map((v,j)=>[v,loc+'.variants['+j+']']):[])]){
   if(!view||!Array.isArray(view.ingredients))continue;
   view.ingredients.forEach((item,j)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return;
    const at=p+'.ingredients['+j+']';
    if(item.componentRecipeId===undefined){
     if(item.readyMadeName!==undefined)fail(at+'.readyMadeName','koopalternatief zonder gekoppeld basisrecept');
     return;
    }
    if(!isText(item.componentRecipeId)||!ID.test(item.componentRecipeId)){
     fail(at+'.componentRecipeId','ongeldige verwijzing naar basisrecept');return;
    }
    const base=byRecipeId.get(item.componentRecipeId);
    if(!base){fail(at+'.componentRecipeId','gekoppeld basisrecept bestaat niet');return;}
    if(typeof base.outputQty!=='number'||base.outputQty<=0||!isText(base.outputUnit))
     fail(at+'.componentRecipeId','basisrecept heeft geen geldige opbrengst');
    if(item.unit!==base.outputUnit)
     fail(at+'.unit','eenheid komt niet overeen met de opbrengst van het basisrecept');
    if(typeof item.qty!=='number'||!Number.isFinite(item.qty)||item.qty<=0)
     fail(at+'.qty','gekoppeld ingrediënt moet een positieve hoeveelheid hebben');
    if(!isText(item.readyMadeName))
     fail(at+'.readyMadeName','naam van kant-en-klaar alternatief ontbreekt');
    dependencies.add(base.id);
   });
  }
  dependencyGraph.set(r.id,dependencies);
 });
 const visiting=new Set(),done=new Set();
 function visit(id,trail){
  if(visiting.has(id)){fail('receptkoppelingen','cirkel in basisrecepten: '+[...trail,id].join(' → '));return;}
  if(done.has(id))return;
  visiting.add(id);
  for(const next of dependencyGraph.get(id)||[])visit(next,[...trail,id]);
  visiting.delete(id);done.add(id);
 }
 for(const id of dependencyGraph.keys())visit(id,[]);
 return {errors,warnings,stats:{recipes:data.length,variants,images}};
}
if(require.main===module){
 let recipes;
 try{recipes=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../recepten.json'),'utf8'));}
 catch(e){console.error('FOUT: recepten.json lezen mislukt:',e.message);process.exitCode=1;}
 if(recipes){
  const result=validateRecipes(recipes);
  console.log('Gecontroleerd:',result.stats.recipes,'recepten,',result.stats.variants,'varianten,',result.stats.images,'afbeeldingen.');
  result.warnings.forEach(x=>console.warn('WAARSCHUWING:',x));
  result.errors.forEach(x=>console.error('FOUT:',x));
  if(result.errors.length){console.error('AFGEKEURD:',result.errors.length,'fout(en)');process.exitCode=1;}
  else console.log('GESLAAGD. Waarschuwingen:',result.warnings.length);
 }
}
module.exports={validateRecipes};
