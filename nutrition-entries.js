/* Porties en vastgelegde voedingswaarden. Geen afhankelijkheid van actuele recepten bij aanpassen. */
(function(root){
 'use strict';
 const KEYS=['kcal','proteinG','carbsG','fatG','fiberG'];
 const clone=value=>JSON.parse(JSON.stringify(value));
 const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
 const quantityValid=value=>Number.isFinite(value)&&value>=0.25&&value<=20&&Math.abs(value*4-Math.round(value*4))<1e-8;
 function nutritionValid(n,perPortion=false){
  return n&&typeof n==='object'&&!Array.isArray(n)&&KEYS.every(key=>
   key!=='kcal'&&n[key]===null||typeof n[key]==='number'&&Number.isFinite(n[key])&&n[key]>=0&&
   n[key]<=(key==='kcal'?(perPortion?80000:20000):(perPortion?8000:2000)));
 }
 function copyNutrition(n){return Object.fromEntries(KEYS.map(key=>[key,n[key]]));}
 function scaleNutrition(n,quantity){
  if(!nutritionValid(n,true)||!quantityValid(quantity))throw Error('Kies een hoeveelheid van 0,25 tot 20, in stappen van 0,25.');
  const result=Object.fromEntries(KEYS.map(key=>[key,n[key]===null?null:Math.round(n[key]*quantity*10)/10]));
  if(!nutritionValid(result))throw Error('Deze hoeveelheid overschrijdt de voedingslimiet per registratie.');
  return result;
 }
 function portionLabel(recipe){
  if(text(recipe.nutrition?.portionLabel,200))return recipe.nutrition.portionLabel.trim();
  if(recipe.servingUnit==='stokbroden')return '1 heel stokbrood';
  const count=Number(recipe.servings||recipe.portions)||2;
  return (count===1?'het hele basisrecept':'1/'+count+' van het basisrecept')+' (voor 1 persoon)';
 }
 function portionOf(entry){
  if(entry.portion)return clone(entry.portion);
  return {quantity:1,label:entry.source==='recipe'?'de volledige opgeslagen maaltijd':
   entry.source==='preset'?'de oorspronkelijke standaardmaaltijd':'de ingevoerde maaltijd',nutrition:copyNutrition(entry.nutrition)};
 }
 function cleanEntry(item){
  if(!item||typeof item!=='object'||!text(item.id,150)||!text(item.title,200)||!nutritionValid(item.nutrition))
   throw Error('Ongeldige maaltijdgegevens.');
  const source=item.source==='recipe'?'recipe':item.source==='preset'?'preset':'manual';
  const result={id:item.id,title:item.title,source,nutrition:copyNutrition(item.nutrition)};
  if(item.confirmed!==undefined&&typeof item.confirmed!=='boolean'||
     item.adjusted!==undefined&&typeof item.adjusted!=='boolean'||
     item.presetSlot!==undefined&&!['ontbijt','lunch'].includes(item.presetSlot))throw Error('Ongeldige bevestigingsstatus.');
  if(source==='preset'){
   result.confirmed=item.confirmed!==false;
   if(item.adjusted===true)result.adjusted=true;
   if(item.presetSlot)result.presetSlot=item.presetSlot;
  }
  if(item.portion!==undefined){
   const p=item.portion;
   if(!p||!quantityValid(p.quantity)||!text(p.label,200)||!nutritionValid(p.nutrition,true))
    throw Error('Ongeldige portiegegevens.');
   const total=scaleNutrition(p.nutrition,p.quantity);
   if(KEYS.some(key=>total[key]===null?result.nutrition[key]!==null:
    result.nutrition[key]===null||Math.abs(total[key]-result.nutrition[key])>0.051))
    throw Error('Porties en voedingswaarden komen niet overeen.');
   result.portion={quantity:p.quantity,label:p.label,nutrition:copyNutrition(p.nutrition)};
  }
  if(item.recipe!==undefined){
   const r=item.recipe,id=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,149}$/.test(value);
   if(source!=='recipe'||!result.portion||!r||!id(r.id)||!id(r.variantId)||!text(r.title,170)||
    !Number.isSafeInteger(r.version)||r.version<1||!Number.isSafeInteger(r.baseVersion)||r.baseVersion<1)
    throw Error('Ongeldige herkomst van het recept.');
   result.recipe={id:r.id,variantId:r.variantId,version:r.version,baseVersion:r.baseVersion,title:r.title};
  }
  return result;
 }
 function recipeTitle(recipe,quantity){return recipe.title+' · '+quantity.toLocaleString('nl-NL',{maximumFractionDigits:2})+' portie(s)';}
 function fromRecipe(option,quantity,id){
  const recipe={id:option.id,variantId:option.variant,version:option.version,baseVersion:option.baseVersion,title:option.title.slice(0,170)};
  const portion={quantity,label:option.portionLabel,nutrition:copyNutrition(option.nutrition)};
  return cleanEntry({id,source:'recipe',title:recipeTitle(recipe,quantity),recipe,portion,
   nutrition:scaleNutrition(portion.nutrition,quantity)});
 }
 function adjustedEntry(entry,{quantity,title,nutrition}){
  if(!quantityValid(quantity))throw Error('Kies een hoeveelheid van 0,25 tot 20, in stappen van 0,25.');
  const portion=portionOf(entry);
  // Recepten gebruiken altijd hun opgeslagen voedingswaarden. Eigen invoer kan worden gecorrigeerd.
  if(!entry.recipe){
   if(!nutritionValid(nutrition))throw Error('Controleer de voedingswaarden.');
   portion.nutrition=Object.fromEntries(KEYS.map(key=>[key,nutrition[key]===null?null:nutrition[key]/quantity]));
  }
  portion.quantity=quantity;
  return cleanEntry({...entry,title:entry.recipe?recipeTitle(entry.recipe,quantity):title,
   portion,nutrition:entry.recipe?scaleNutrition(portion.nutrition,quantity):copyNutrition(nutrition),
   ...(entry.source==='preset'?{confirmed:true,adjusted:true}:{})});
 }
 const api={KEYS,quantityValid,nutritionValid,scaleNutrition,portionLabel,portionOf,cleanEntry,fromRecipe,adjustedEntry};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.CookbookNutrition=api;
})(typeof window!=='undefined'?window:globalThis);
