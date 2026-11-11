'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {validateRecipes}=require('../scripts/validate-recipes.cjs');
const CookbookPantry=require('../pantry.js');
const root=path.resolve(__dirname,'..');
const recipes=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=html.match(/<script>\s*'use strict';([\s\S]*?)<\/script>/);
assert.ok(js,'Hoofdscript ontbreekt');
const clone=()=>JSON.parse(JSON.stringify(recipes));
const check=data=>validateRecipes(data,{rootDir:root});
const groups=['maaltijd','overig','onderdeel'];

test('Alle recepten hebben één expliciet en geldig recepttype',()=>{
 assert.deepEqual(check(recipes).errors,[]);
 assert.ok(recipes.length>=30);
 const counts=Object.fromEntries(groups.map(type=>[type,recipes.filter(x=>x.recipeType===type).length]));
 assert.equal(Object.values(counts).reduce((n,v)=>n+v,0),recipes.length);
 for(const type of groups)assert.ok(counts[type]>0);
 assert.equal(new Set(recipes.map(x=>x.id)).size,recipes.length);
});
test('Basisrecepten, losse kipschnitzel en maaltijden zijn terecht onderscheiden',()=>{
 for(const id of ['kruidenboter','stokbrood','gekruide-kipschnitzel'])
  assert.equal(recipes.find(x=>x.id===id).recipeType,'onderdeel',id);
 for(const id of ['zalm','hamburgers','piripiri','italiaanse-pesto-salamipizza-flatbread'])
  assert.equal(recipes.find(x=>x.id===id).recipeType,'maaltijd',id);
 for(const id of ['chocolademelk','aperol-spritz','bruschetta','chocolade-lavacake-pure-chocolade'])
  assert.equal(recipes.find(x=>x.id===id).recipeType,'overig',id);
});
test('Hoofdcategorie, porties, receptidentiteit en varianten blijven behouden',()=>{
 const p=recipes.find(x=>x.id==='pasta-rundergehakt-groenten');
 assert.equal(p.category,'Pasta');
 assert.equal(p.variants[0].id,'romig');
 assert.equal(p.recipeType,'maaltijd');
 const base=recipes.find(x=>x.id==='kruidenboter');
 assert.equal(base.outputQty,40);
 const bread=recipes.find(x=>x.id==='gevuld-kruidenboterstokbrood-kaas-oregano');
 assert.equal(bread.ingredients.find(x=>x.componentRecipeId).componentRecipeId,'kruidenboter');
});
test('Ontbrekend en onbekend recepttype wordt afgekeurd',()=>{
 const a=clone();delete a[0].recipeType;
 assert.match(check(a).errors.join('\n'),/recipeType.*verplicht type/);
 const b=clone();b[0].recipeType='overig-type';
 assert.match(check(b).errors.join('\n'),/recipeType.*verplicht type/);
});
test('Varianten mogen niet afwijken van hoofdindeling',()=>{
 const data=clone(),p=data.find(x=>x.id==='pasta-rundergehakt-groenten');
 p.variants[0].recipeType='onderdeel';
 assert.match(check(data).errors.join('\n'),/varianten delen het type/);
});
test('Een variant mag hetzelfde expliciete type hebben als het hoofdrecept',()=>{
 const r=recipes.find(x=>x.id==='klassieke-saucijzenbroodjes');
 assert.equal(r.variants[0].recipeType,r.recipeType);
 assert.deepEqual(check(clone()).errors,[]);
});
test('Ingrediënten mogen alleen naar een gemarkeerd basisrecept verwijzen',()=>{
 const data=clone();
 data.find(x=>x.id==='kruidenboter').recipeType='maaltijd';
 assert.match(check(data).errors.join('\n'),/gekoppeld recept moet een basisrecept of onderdeel zijn/);
});
function browser(){
 const elements=new Map(),storage=new Map(),buttons=new Map(),counters=new Map();
 function element(id){
  if(elements.has(id))return elements.get(id);
  const e={id,value:'',textContent:'',hidden:false,open:false,checked:false,dataset:{},innerHTML:'',style:{},
   classList:{add(){},remove(){},toggle(){}},add(){},querySelectorAll(){return []},
   contains(x){return x===this},setAttribute(name,value){this['attr_'+name]=value},removeAttribute(name){delete this['attr_'+name]},
   addEventListener(type,listener){this['on'+type]=listener},focus(){},scrollIntoView(){}};
  elements.set(id,e);return e;
 }
 for(const type of ['',...groups]){
  const b={dataset:{recipeType:type},setAttribute(name,value){this['attr_'+name]=value},
   addEventListener(name,fn){this['on'+name]=fn}};
  buttons.set(type,b);
  counters.set(type||'all',{dataset:{recipeTypeCount:type||'all'},textContent:''});
 }
 const document={
  getElementById:element,querySelector:()=>element('top'),
  querySelectorAll(selector){
   if(selector==='[data-recipe-type]')return [...buttons.values()];
   if(selector==='[data-recipe-type-count]')return [...counters.values()];
   return [];
  },
  addEventListener(){},title:'Mijn Kookboek',visibilityState:'visible',
  body:{classList:{add(){},remove(){}},appendChild(){}},
  createElement:()=>({click(){},remove(){}})
 };
 const location={hash:'',href:''},navigator={onLine:true};
 const window={CookbookScaling:require('../recipe-scaling.js'),location,navigator,CookbookPantry,isSecureContext:false,
  addEventListener(){},matchMedia:()=>({matches:false}),scrollTo(){},confirm:()=>true,print(){}};
 const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const app=new Function('document','window','navigator','localStorage','location','fetch','Option',
  'setInterval','clearInterval','queueMicrotask','setTimeout',
  "'use strict';"+js[1]+"\nreturn {refreshRecipeCollection,renderCards,renderDetail,renderBasket,route,resetBrowse,setRecipeTypeFilter,recipeTypeLabel,viewFor,basketItems,getBasket:()=>basket};")(
   document,window,navigator,localStorage,location,
   async()=>({ok:true,json:async()=>recipes}),
   function Option(label,value){this.label=label;this.value=value},
   ()=>0,()=>{},fn=>fn(),()=>0);
 return {app,element,buttons,counters,location,storage,
  async ready(){await app.refreshRecipeCollection()},
  select(type){const b=buttons.get(type);assert.equal(typeof b.onclick,'function');b.onclick()},
  show(id){location.hash='#recept/'+id;app.route()},
  ids(){return [...element('cards').innerHTML.matchAll(/data-recipe="([^"]+)"/g)].map(m=>m[1])}
 };
}
test('Tabbladen tonen alle groepstellingen en standaard alle recepten',async()=>{
 const b=browser();await b.ready();
 assert.equal(b.ids().length,recipes.length);
 for(const type of groups)
  assert.equal(Number(b.counters.get(type).textContent),recipes.filter(r=>r.recipeType===type).length);
 assert.equal(b.buttons.get('')['attr_aria-pressed'],'true');
});
test('Receptgroepfilter toont uitsluitend geselecteerde soort',async()=>{
 const b=browser();await b.ready();
 b.select('onderdeel');
 assert.deepEqual(b.ids().sort(),['gekruide-kipschnitzel','kruidenboter','stokbrood'].sort());
 assert.equal(b.buttons.get('onderdeel')['attr_aria-pressed'],'true');
 assert.equal(b.buttons.get('maaltijd')['attr_aria-pressed'],'false');
 assert.equal(b.element('resetFilters').hidden,false);
 b.select('maaltijd');
 assert.equal(b.ids().length,recipes.filter(r=>r.recipeType==='maaltijd').length);
 assert.ok(b.ids().includes('gnocchi'));
 assert.ok(!b.ids().includes('chocolademelk'));
 b.select('overig');
 assert.equal(b.ids().length,recipes.filter(r=>r.recipeType==='overig').length);
 assert.ok(b.ids().includes('bruschetta'));
 assert.ok(!b.ids().includes('kruidenboter'));
});
test('Recepttype combineert met bestaande categorie en tekstzoeker',async()=>{
 const b=browser();await b.ready();
 b.select('onderdeel');
 b.element('category').value='Kip';
 b.app.renderCards();
 assert.deepEqual(b.ids(),['gekruide-kipschnitzel']);
 b.element('search').value='krokant';
 b.app.renderCards();
 assert.deepEqual(b.ids(),['gekruide-kipschnitzel']);
 b.element('search').value='stokbrood';
 b.app.renderCards();
 assert.equal(b.ids().length,0);
});
test('Alle recepten en Wis filters herstellen de complete collectie',async()=>{
 const b=browser();await b.ready();
 b.select('onderdeel');b.select('');
 assert.equal(b.ids().length,recipes.length);
 b.select('overig');b.app.resetBrowse();
 assert.equal(b.ids().length,recipes.length);
 assert.equal(b.buttons.get('')['attr_aria-pressed'],'true');
});
test('Receptkaarten, details en varianten tonen het juiste type',async()=>{
 const b=browser();await b.ready();
 assert.match(b.element('cards').innerHTML,/Basisrecept \/ onderdeel/);
 b.show('kruidenboter');
 assert.match(b.element('detail').innerHTML,/Basisrecept \/ onderdeel/);
 assert.match(b.element('detail').innerHTML,/Dit is een basisrecept of gerechtsonderdeel/);
 b.show('pasta-rundergehakt-groenten');
 assert.match(b.element('detail').innerHTML,/Maaltijd/);
 b.element('detail').dataset.variantId='romig';
 b.app.renderDetail();
 assert.match(b.element('detail').innerHTML,/Maaltijd/);
});
test('Gekoppelde basisrecepten blijven werken op de boodschappenlijst',async()=>{
 const b=browser();await b.ready();
 b.show('gevuld-kruidenboterstokbrood-kaas-oregano');
 b.element('addBasket').onclick();
 b.location.hash='#boodschappenlijst';b.app.route();
 const text=b.element('basket').innerHTML;
 assert.match(text,/kruidenboter/i);
 assert.match(text,/Zelf maken/);
 assert.match(text,/Bekijk basisrecept/);
 assert.ok(b.app.basketItems().length>0);
});

test('Nieuw gerecht runderkofta is een maaltijd voor twee en heeft volledige bereidingsstappen',()=>{
 const kofta=recipes.find(r=>r.id==='runderkofta-flatbread-knoflook-yoghurtsaus');
 assert.ok(kofta,'runderkofta ontbreekt');
 assert.equal(kofta.recipeType,'maaltijd');
 assert.equal(kofta.category,'Rundvlees');
 assert.equal(kofta.servings,2);
 assert.equal(kofta.minutes,38);
 assert.equal(kofta.version,kofta.changeLog.at(-1).version);
 assert.equal(kofta.updatedAt,kofta.changeLog.at(-1).date);
 assert.equal(kofta.steps.length,6);
 const used=new Set(kofta.steps.flatMap(s=>s.ingredientIndices));
 assert.equal(used.size,kofta.ingredients.length,'alle ingrediënten moeten in de stappen terugkomen');
 assert.ok(kofta.nutrition.estimated);
});

