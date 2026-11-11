'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateRecipes}=require('../scripts/validate-recipes.cjs');
const CookbookPantry=require('../pantry.js');

const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,'inlinescript van kookboek ontbreekt');
const js=match[1];
const parent='gevuld-kruidenboterstokbrood-kaas-oregano',child='kruidenboter';
const key=parent+':klassiek';
const clone=x=>JSON.parse(JSON.stringify(x));
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,actual+' is niet '+expected);

function browser(){
 const elements=new Map(),storage=new Map();
 function element(id){
  if(elements.has(id))return elements.get(id);
  let html='',children=new Map();
  const node={
   id,dataset:{},style:{},hidden:false,checked:false,value:'',textContent:'',add(){},
   classList:{add(){},remove(){},toggle(){}},
   setAttribute(){},removeAttribute(){},addEventListener(k,f){this['on'+k]=f;},focus(){},
   contains(x){return x===this;},scrollIntoView(){},
   querySelectorAll(selector){
    if(children.has(selector))return children.get(selector);
    let found=[];
    if(id==='basket'&&selector==='[data-component-key]'){
     found=[...html.matchAll(/<select[^>]*data-component-key="([^"]+)"[^>]*data-component-index="(\d+)"[^>]*>[\s\S]*?<\/select>/g)]
      .map(m=>({
       dataset:{componentKey:m[1],componentIndex:m[2]},
       value:/<option value="buy" selected>/.test(m[0])?'buy':'make',
       onchange:null
      }));
    }
    children.set(selector,found);
    return found;
   }
  };
  Object.defineProperty(node,'innerHTML',{get(){return html},set(x){html=String(x);children=new Map();}});
  elements.set(id,node);
  return node;
 }
 const document={
  getElementById:element,
  querySelectorAll:()=>[],
  querySelector:()=>element('other'),
  addEventListener(){},
  title:'Mijn Kookboek',
  visibilityState:'visible',
  body:{classList:{add(){},remove(){}},appendChild(){}},
  createElement:()=>({click(){},remove(){}})
 };
 const location={hash:'',href:''},navigator={onLine:true};
 const window={CookbookScaling:require('../recipe-scaling.js'),location,navigator,CookbookPantry,isSecureContext:false,matchMedia:()=>({matches:false}),addEventListener(){},confirm:()=>true,scrollTo(){},print(){}};
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const api=new Function('document','window','navigator','localStorage','location','fetch','Option','setInterval','clearInterval','queueMicrotask','setTimeout',
  js+'\nreturn {refreshRecipeCollection,route,renderBasket,basketItems,getBasket:()=>basket,getChecks:()=>checked,getRecipes:()=>recipes};')(
  document,window,navigator,localStorage,location,
  async()=>({ok:true,json:async()=>catalog}),
  function Option(label,value){this.label=label;this.value=value;},
  ()=>0,()=>{},cb=>cb(),()=>0
 );
 const basketItems=()=>api.basketItems();
 const find=name=>basketItems().find(x=>x.name===name);
 return {api,element,location,storage,find,basketItems,
  async ready(){await api.refreshRecipeCollection();},
  addRecipe(id){
   location.hash='#recept/'+id;api.route();
   element('addBasket').onclick();
  },
  goBasket(){location.hash='#boodschappenlijst';api.route();}
 };
}
test('Huidige gekoppelde recepten zijn geldig',()=>{
 const result=validateRecipes(catalog,{rootDir:root});
 assert.deepEqual(result.errors,[]);
});
test('Het basisrecept heeft de juiste opbrengst en parent-koppeling',()=>{
 const main=catalog.find(r=>r.id===parent),base=catalog.find(r=>r.id===child);
 assert.equal(base.outputQty,40);
 assert.equal(base.outputUnit,'g');
 assert.equal(main.ingredients[1].componentRecipeId,child);
 assert.equal(main.ingredients[1].readyMadeName,'Kruidenboter (kant-en-klaar)');
});
test('Het recept bevat een klikbare verwijzing naar het basisrecept',async()=>{
 const b=browser();await b.ready();b.location.hash='#recept/'+parent;b.api.route();
 assert.match(b.element('detail').innerHTML,/href="#recept\/kruidenboter"/);
});
test('Standaard zelf maken: roomboter en smaakmakers, zonder koopproduct',async()=>{
 const b=browser();await b.ready();b.addRecipe(parent);b.goBasket();
 assert.match(b.element('basket').innerHTML,/Zelf maken/);
 assert.match(b.element('basket').innerHTML,/Kant-en-klaar kopen/);
 close(b.find('Ongezouten roomboter').qty,40);
 assert.ok(b.find('Knoflook'));
 assert.ok(b.find('Verse peterselie'));
 assert.equal(b.find('Kruidenboter (kant-en-klaar)'),undefined);
 assert.equal(b.find('Oregano').qty,2.5);
});
test('Overschakelen naar kant-en-klaar bewaart keuze en vervangt basis-ingrediënten',async()=>{
 const b=browser();await b.ready();b.addRecipe(parent);b.goBasket();
 const [select]=b.element('basket').querySelectorAll('[data-component-key]');
 assert.ok(select);
 select.value='buy';select.onchange();
 assert.equal(b.api.getBasket()[key].componentModes[1],'buy');
 assert.equal(JSON.parse(b.storage.get('mijn-kookboek-boodschappen'))[key].componentModes[1],'buy');
 close(b.find('Kruidenboter (kant-en-klaar)').qty,40);
 assert.equal(b.find('Ongezouten roomboter'),undefined);
 assert.equal(b.find('Knoflook'),undefined);
 assert.equal(b.find('Verse peterselie'),undefined);
 assert.match(b.element('basket').innerHTML,/option value="buy" selected/);
 assert.doesNotMatch(b.element('basket').innerHTML,/Optionele ingrediënten meenemen/);
});
test('Terug naar zelf maken toont opnieuw ingrediënten',async()=>{
 const b=browser();await b.ready();b.addRecipe(parent);b.goBasket();
 let select=b.element('basket').querySelectorAll('[data-component-key]')[0];
 select.value='buy';select.onchange();
 select=b.element('basket').querySelectorAll('[data-component-key]')[0];
 select.value='make';select.onchange();
 close(b.find('Ongezouten roomboter').qty,40);
 assert.equal(b.find('Kruidenboter (kant-en-klaar)'),undefined);
});
test('Van twee naar vier personen schaalt zowel maak- als koopoptie',async()=>{
 const b=browser();await b.ready();b.addRecipe(parent);
 b.api.getBasket()[key].servings=4;
 close(b.basketItems().find(x=>x.name==='Ongezouten roomboter').qty,80);
 b.api.getBasket()[key].componentModes={'1':'buy'};
 close(b.basketItems().find(x=>x.name==='Kruidenboter (kant-en-klaar)').qty,80);
 b.goBasket();
 assert.match(b.element('basket').innerHTML,/80 g/);
});
test('Optionele oregano uit basisrecept wordt alleen toegevoegd als die is aangevinkt',async()=>{
 const b=browser();await b.ready();b.addRecipe(parent);
 close(b.find('Oregano').qty,2.5);
 b.api.getBasket()[key].includeOptional=true;
 close(b.find('Oregano').qty,3.125);
 assert.match(b.find('Oregano').name,/Oregano/);
});
test('Los toegevoegd basisrecept wordt met andere hoeveelheden samengevoegd',async()=>{
 const b=browser();await b.ready();b.addRecipe(parent);b.addRecipe(child);
 close(b.find('Ongezouten roomboter').qty,80);
 assert.equal(b.basketItems().filter(x=>x.name==='Ongezouten roomboter').length,1);
});
test('Als kruidenboter al in huis is, verschijnen de grondstoffen niet op boodschappenlijst',async()=>{
 const b=browser();await b.ready();b.addRecipe(parent);
 b.api.getChecks()[key]=[1];
 assert.equal(b.find('Ongezouten roomboter'),undefined);
 assert.equal(b.find('Kruidenboter (kant-en-klaar)'),undefined);
 b.goBasket();
 assert.doesNotMatch(b.element('basket').innerHTML,/<select[^>]+data-component-key/);
});
test('Ongekoppelde recepten blijven de oorspronkelijke boodschappen opleveren',async()=>{
 const b=browser();await b.ready();b.addRecipe('hamburgers');
 assert.ok(b.find('Rundergehakt'));
 assert.ok(b.find('Komijn'));
 assert.equal(b.find('Ongezouten roomboter'),undefined);
});
const rejects=(name,mutate,pattern)=>test(name,()=>{
 const data=clone(catalog);
 mutate(data);
 assert.match(validateRecipes(data,{rootDir:root}).errors.join('\n'),pattern);
});
rejects('Onbekende basisrecept-ID wordt afgekeurd',r=>{
 r.find(x=>x.id===parent).ingredients[1].componentRecipeId='niet-bestaand';
},/gekoppeld basisrecept bestaat niet/);
rejects('Eenheid moet overeenkomen met de opbrengst',r=>{
 r.find(x=>x.id===parent).ingredients[1].unit='ml';
},/eenheid komt niet overeen/);
rejects('Basisrecept zonder opbrengst wordt afgekeurd',r=>{
 delete r.find(x=>x.id===child).outputQty;
},/basisrecept heeft geen geldige opbrengst/);
rejects('Lege naam voor koopproduct wordt afgekeurd',r=>{
 r.find(x=>x.id===parent).ingredients[1].readyMadeName='';
},/naam van kant-en-klaar alternatief ontbreekt/);
rejects('Circulaire receptkoppelingen worden afgekeurd',r=>{
 r.find(x=>x.id===child).ingredients[0].componentRecipeId=parent;
 r.find(x=>x.id===child).ingredients[0].readyMadeName='Boter';
},/cirkel in basisrecepten/);

