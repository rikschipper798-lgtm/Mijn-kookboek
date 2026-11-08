'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateRecipes}=require('../scripts/validate-recipes.cjs');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const clone=()=>JSON.parse(JSON.stringify(catalog));
const check=(data)=>validateRecipes(data,{rootDir:root});
function rejects(name,change,expected){
 test(name,()=>{
  const data=clone();
  change(data);
  assert.match(check(data).errors.join('\n'),expected);
 });
}
test('Actuele kookboekcollectie bevat geen blokkerende fouten',()=>{
 const result=check(catalog);
 assert.deepEqual(result.errors,[]);
 assert.equal(result.stats.recipes,catalog.length);
 assert.ok(result.stats.variants>=2);
});
test('Afbeeldingen van basisrecepten en varianten bestaan',()=>{
 assert.ok(check(catalog).stats.images>=catalog.length);
 assert.equal(check(catalog).errors.filter(x=>x.includes('.image')).length,0);
});
test('Los ingrediënt zonder stapverwijzing is waarschuwing',()=>{
 const result=check(catalog);
 assert.ok(result.warnings.some(x=>x.includes('Zout')));
});
test('Null is toegestaan bij kruiden naar smaak',()=>{
 const data=clone();
 data[0].ingredients[0]={name:'Zout',qty:null,unit:'naar smaak',group:'Kruiden'};
 assert.equal(check(data).errors.length,0);
});
test('Tips ondersteunen tekst en een lijst',()=>{
 const data=clone();
 data[0].tips=['Kruid de kip goed.'];
 assert.equal(check(data).errors.length,0);
});
rejects('Dubbele recept-ID wordt afgekeurd',data=>data.push({...data[0],id:data[1].id}),/dubbele ID/);
rejects('Alias die een ander recept overschrijft wordt afgekeurd',data=>{data[0].aliases=[data[1].id];},/dubbele ID/);
rejects('Lege titel wordt afgekeurd',data=>{data[0].title='';},/verplicht niet-leeg/);
rejects('Ongeldige datum wordt afgekeurd',data=>{data[0].date='2026-02-31';},/ongeldige datum/);
rejects('Ontbrekende voedingswaarden worden afgekeurd',data=>{delete data[0].nutrition;},/voedingswaarden per portie ontbreken/);
rejects('Een negatieve voedingswaarde wordt afgekeurd',data=>{data[0].nutrition.proteinG=-5;},/voedingswaarde moet een niet-negatief getal zijn/);
rejects('Elke variant moet eigen voedingswaarden hebben',data=>{
 const r=data.find(x=>x.variants?.length);delete r.variants[0].nutrition;
},/voedingswaarden per portie ontbreken/);
rejects('Negatieve hoeveelheid wordt afgekeurd',data=>{data[0].ingredients[0].qty=-1;},/positief getal/);
rejects('Onbekende eenheid wordt afgekeurd',data=>{data[0].ingredients[0].unit='bananen';},/onbekende eenheid/);
rejects('Null met standaardmaat wordt afgekeurd',data=>{data[0].ingredients[0].qty=null;},/null alleen/);
rejects('Onbestaande afbeelding wordt afgekeurd',data=>{data[0].image='images/niet-bestaand.webp';},/afbeelding bestaat niet/);
rejects('Onveilig afbeeldingspad wordt afgekeurd',data=>{data[0].image='images\/..\/images\/test.webp';},/ongeldig afbeeldingspad/);
rejects('Ingrediëntindex buiten lijst wordt afgekeurd',data=>{data[0].steps[0].ingredientIndices=[999];},/ongeldige ingrediëntindex/);
rejects('Dubbele stapverwijzing wordt afgekeurd',data=>{data[0].steps[0].ingredientIndices=[0,0];},/dubbele ingrediëntverwijzing/);
rejects('Ontbrekende stappen worden afgekeurd',data=>{data[0].steps=[];},/minimaal één bereidingsstap/);
rejects('Te korte totale tijd wordt afgekeurd',data=>{data[0].prep=999;},/totaal korter/);
rejects('Ongeldig marinadeschema wordt afgekeurd',data=>{data.find(r=>r.id==='piripiri').marinateTiming='overlap';},/kies included/);
rejects('Onjuiste rijsverdeling wordt afgekeurd',data=>{data.find(r=>r.id==='stokbrood').minutes=1200;},/rijs- en rusttijden/);
rejects('Onlogische optionele wachttijd wordt afgekeurd',data=>{
 const r=data.find(x=>x.id==='arayes');
 r.optionalWaitMinMinutes=40;r.optionalWaitMaxMinutes=10;
},/maximum kleiner/);
rejects('Dubbele variant-ID wordt afgekeurd',data=>{
 const r=data.find(x=>x.variants);
 r.variants.push(JSON.parse(JSON.stringify(r.variants[0])));
},/dubbele variant-ID/);
rejects('Onjuiste afrondstap voor eieren wordt afgekeurd',data=>{
 data.find(x=>x.id==='chocolade-lavacake-pure-chocolade').ingredients.find(x=>x.scaleRoundTo).qty=3;
},/niet deelbaar/);
