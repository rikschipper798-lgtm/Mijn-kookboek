'use strict';
/* Eén gegevenscontract voor het kookboek en Mijn account en gegevens. */
(function(root){
const BACKUP_APP='mijn-kookboek',BACKUP_VERSION=1;
const BACKUP_FIELDS=['favorites','ingredientChecks','basket','basketChecks','notes','cookProgress'];
const STORAGE={favorites:'mijn-kookboek-favorieten',ingredientChecks:'mijn-kookboek-receptchecks',basket:'mijn-kookboek-boodschappen',basketChecks:'mijn-kookboek-boodschappenchecks',pantry:'mijn-kookboek-voorraad',notes:'mijn-kookboek-persoonlijke-notities',cookProgress:'mijn-kookboek-kookvoortgang'};
function backupObject(value){
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function backupKey(key){
 return typeof key==='string'&&key.length>0&&key.length<=500&&!['__proto__','constructor','prototype'].includes(key);
}
function backupMap(value,label,validate,maximum=2000){
 if(!backupObject(value)||Object.keys(value).length>maximum)throw Error('Ongeldige '+label+'.');
 const entries=Object.entries(value);
 for(const [key,item] of entries){
  if(!backupKey(key)||!validate(item,key))throw Error('Ongeldige '+label+'; dit bestand kan niet worden hersteld.');
 }
 // Object.fromEntries houdt ook bijzondere namen als gewone eigen sleutels.
 return Object.fromEntries(entries);
}
function validPersonal(payload,pantry){
 if(!backupObject(payload)||payload.app!==BACKUP_APP||payload.version!==BACKUP_VERSION||
    !backupObject(payload.data)||typeof payload.exportedAt!=='string'||!Number.isFinite(Date.parse(payload.exportedAt))) {
  throw Error('Dit is geen ondersteund Mijn Kookboek-back-upbestand (versie 1).');
 }
 if(!BACKUP_FIELDS.every(name=>Object.prototype.hasOwnProperty.call(payload.data,name))){
  throw Error('Het bestand is onvolledig; er ontbreken persoonlijke gegevens.');
 }
 const data=payload.data;
 if(!Array.isArray(data.favorites)||data.favorites.length>2000||
    !data.favorites.every(x=>typeof x==='string'&&backupKey(x))){
  throw Error('Ongeldige favorieten in het back-upbestand.');
 }
 const favoritesList=[...new Set(data.favorites)];
 const ingredientChecks=backupMap(data.ingredientChecks,'ingrediëntstatussen',value=>
  Array.isArray(value)&&value.length<=1000&&value.every(x=>Number.isInteger(x)&&x>=0&&x<=10000));
 const basketData=backupMap(data.basket,'boodschappenrecepten',value=>
  backupObject(value)&&typeof value.id==='string'&&backupKey(value.id)&&
  (value.variantId===undefined||typeof value.variantId==='string'&&value.variantId.length<=200)&&
  Number.isFinite(value.servings)&&value.servings>=1&&value.servings<=1000&&
  (value.includeOptional===undefined||typeof value.includeOptional==='boolean'),1000);
 const basketChecks=backupMap(data.basketChecks,'boodschappenstatussen',value=>typeof value==='boolean',5000);
 const notes=backupMap(data.notes,'kooknotities',value=>
  backupObject(value)&&
  (value.notes===undefined||typeof value.notes==='string'&&value.notes.length<=5000)&&
  (value.feedback===undefined||typeof value.feedback==='string'&&value.feedback.length<=5000)&&
  (value.rating===undefined||Number.isInteger(value.rating)&&value.rating>=0&&value.rating<=5)&&
  (value.lastCookedOn===undefined||typeof value.lastCookedOn==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.lastCookedOn)));
 const cookProgressData=backupMap(data.cookProgress,'kookvoortgang',value=>
  backupObject(value)&&Number.isInteger(value.step)&&value.step>=0&&value.step<=1000&&typeof value.done==='boolean');
 const pantryData=data.pantry===undefined?null:pantry.validate(data.pantry);
 return {
  exportedAt:payload.exportedAt,
  data:{favorites:favoritesList,ingredientChecks,basket:basketData,basketChecks,notes,cookProgress:cookProgressData,pantry:pantryData}
 };
}

function personal(data,pantry){
 const result=validPersonal({app:BACKUP_APP,version:1,exportedAt:new Date().toISOString(),data},pantry).data;
 if(result.pantry===null)throw Error('De standaardvoorraad ontbreekt.');
 if(new TextEncoder().encode(JSON.stringify(result)).length>1800000)throw Error('De kookboekgegevens zijn te groot.');
 return result;
}
function readPersonal(storage,pantry){
 const data={};
 for(const [field,key] of Object.entries(STORAGE)){
  const raw=storage.getItem(key);
  data[field]=raw===null?(field==='favorites'?[]:field==='pantry'?pantry.defaults():{}):JSON.parse(raw);
 }
 return personal(data,pantry);
}
function personalWrites(data){return Object.entries(STORAGE).map(([field,key])=>({key,value:JSON.stringify(data[field])}));}
// Cloud journals participate in the same synchronous local transaction.
// No upload is scheduled before every browser write has succeeded.
function writeAtomic(storage,writes){
 const previous=new Map();
 for(const {key} of writes){
  if(previous.has(key))throw Error('Dubbele opslagsleutel.');
  previous.set(key,storage.getItem(key));
 }
 try{for(const {key,value} of writes)storage.setItem(key,value);}
 catch(error){
  let restored=true;
  for(const [key,value] of previous){
   try{if(value===null)storage.removeItem(key);else storage.setItem(key,value);}catch(e){restored=false;}
  }
  throw Error(restored?'Opslaan is mislukt. Alle oorspronkelijke gegevens zijn teruggezet.':
   'Opslaan en volledig terugzetten zijn mislukt. Bewaar het back-upbestand en controleer beide onderdelen.');
 }
}
function parseBackup(payload,validateDiary,pantry,storage=root.localStorage){
 if(!backupObject(payload)||payload.version!==1)throw Error('Onbekend back-upformaat.');
 let diary,personalData;
 if(payload.app==='mijn-kookboek-alle-gegevens'){
  if(!backupObject(payload.data)||!payload.data.diary||!payload.data.personal||
     typeof payload.exportedAt!=='string'||!Number.isFinite(Date.parse(payload.exportedAt)))throw Error('De gezamenlijke back-up is onvolledig.');
  diary=validateDiary(payload.data.diary);personalData=personal(payload.data.personal,pantry);
 }else if(payload.app==='mijn-kookboek-voedingsdagboek')diary=validateDiary(payload.data);
 else if(payload.app===BACKUP_APP){
  personalData=validPersonal(payload,pantry).data;
  if(personalData.pantry===null)personalData.pantry=readPersonal(storage,pantry).pantry;
  personalData=personal(personalData,pantry);
 }else throw Error('Dit bestand bevat geen ondersteunde kookboek- of dagboekback-up.');
 if(diary&&new TextEncoder().encode(JSON.stringify(diary)).length>1800000)throw Error('Het dagboek is te groot.');
 return {diary,personal:personalData};
}
function stable(value){
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
const api={STORAGE,validPersonal,personal,readPersonal,personalWrites,writeAtomic,parseBackup,stable};
root.CookbookData=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
