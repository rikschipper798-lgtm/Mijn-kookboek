'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const recipes=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const start=html.indexOf('function nutritionPanel(');
const end=html.indexOf('// Versies vanaf november 2026',start);
assert.ok(start>=0&&end>start,'Voedingswaardenfunctie ontbreekt in de website');
const source=html.slice(start,end);
const show=new Function('safe','portionsLabel',source+'\nreturn nutritionPanel;')(
 value=>String(value),
 (recipe,n)=>n+' '+(recipe.servingUnit==='stokbroden'?'stokbroden':'personen')
);

test('Alle actuele recepten en varianten bevatten complete geschatte voedingswaarden',()=>{
 assert.ok(recipes.length>=30);
 const all=recipes.flatMap(r=>[r,...r.variants||[]]);
 assert.equal(all.length,recipes.length+recipes.reduce((n,r)=>n+(r.variants||[]).length,0));
 for(const recipe of all){
  assert.equal(recipe.nutrition.per,'portie');
  assert.equal(recipe.nutrition.estimated,true);
  for(const name of ['kcal','proteinG','carbsG','fatG','fiberG'])
   assert.ok(Number.isFinite(recipe.nutrition[name])&&recipe.nutrition[name]>=0,recipe.id+': '+name);
  assert.ok(recipe.nutrition.kcal>0);
 }
});

test('Detail toont alle vijf voedingswaarden en schaalt alleen het recepttotaal',()=>{
 const r=recipes.find(x=>x.id==='gnocchi');
 const base=show(r,4),scaled=show(r,6);
 for(const name of ['Energie','Eiwitten','Koolhydraten','Vetten','Vezels'])assert.match(base,new RegExp(name));
 assert.match(base,/740 kcal/);
 assert.match(base,/2\.960 kcal in totaal/);
 assert.match(scaled,/740 kcal/);
 assert.match(scaled,/4\.440 kcal in totaal/);
});

test('Eigen voedingswaarden van een variant worden zichtbaar',()=>{
 const r=recipes.find(x=>x.id==='pasta-rundergehakt-groenten');
 assert.match(show(r,4),/745 kcal/);
 const variant={...r,...r.variants[0]};
 assert.match(show(variant,4),/845 kcal/);
});

test('Bij stokbrood worden de waarden per stokbrood getoond',()=>{
 const bread=recipes.find(x=>x.id==='stokbrood');
 assert.match(show(bread,2),/Schatting per stokbrood/);
});

test('De toelichting maakt de onzekerheid en optionele ingrediënten duidelijk',()=>{
 const out=show(recipes[0],2);
 assert.match(out,/standaardingrediënten/);
 assert.match(out,/optionele ingrediënten/);
 assert.match(out,/bakolie/);
});
