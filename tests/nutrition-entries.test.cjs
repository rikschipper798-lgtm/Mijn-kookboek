'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const N=require('../nutrition-entries.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const root=path.resolve(__dirname,'..');
const recipes=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const recipe=recipes.find(r=>r.id==='klassieke-saucijzenbroodjes');
const option=(r=recipe,v=null)=>({id:r.id,variant:v?.id||'klassiek',title:v?.label||r.title,
 version:v?.version||r.version,baseVersion:r.version,nutrition:v?.nutrition||r.nutrition,portionLabel:N.portionLabel({...r,...v})});
const nutrition={kcal:361,proteinG:12.3,carbsG:40,fatG:15,fiberG:null};
const manual=()=>({id:'manual',title:'Eigen lunch',source:'manual',nutrition:clone(nutrition)});
const legacy=()=>({...manual(),id:'old-recipe',title:'Oud recept · 0,5 portie(s)',source:'recipe'});
const DATE='2026-11-15',OTHER='2026-11-14';
const diary=(entries=[manual()])=>({goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
 days:{[DATE]:entries},weekdayPresets:{},weekdayApplied:{},quickMeals:[]});

test('Porties leggen broodjes, variant en heel stokbrood expliciet uit',()=>{
 assert.equal(N.portionLabel(recipe),'2 saucijzenbroodjes');
 assert.equal(N.portionLabel({...recipe,...recipe.variants[0]}),'2 poestabroodjes');
 assert.equal(N.portionLabel(recipes.find(r=>r.id==='stokbrood')),'1 heel stokbrood');
 assert.equal(N.portionLabel({servings:4}),'1/4 van het basisrecept (voor 1 persoon)');
});
test('Een halve portie bewaart eigen voedingswaarden, portiegrootte, ID en versies',()=>{
 const selected=option(recipe,recipe.variants[0]);
 const e=N.fromRecipe(selected,0.5,'new');
 assert.equal(e.nutrition.kcal,355);
 assert.equal(e.portion.quantity,0.5);
 assert.equal(e.portion.label,'2 poestabroodjes');
 assert.equal(e.recipe.id,recipe.id);
 assert.equal(e.recipe.variantId,'poesta');
 assert.equal(e.recipe.version,recipe.variants[0].version);
 assert.equal(e.recipe.baseVersion,recipe.version);
});
test('Latere receptwijzigingen en herhaald schalen veranderen de opgeslagen basis niet',()=>{
 const selected=clone(option()),e=N.fromRecipe(selected,1,'stable');
 selected.nutrition.kcal=9999;selected.version++;
 const quarter=N.adjustedEntry(e,{quantity:0.25});
 assert.equal(quarter.nutrition.kcal,186.3);
 const full=N.adjustedEntry(quarter,{quantity:1,nutrition:{kcal:0}});
 assert.equal(full.id,'stable');assert.equal(full.nutrition.kcal,745);
 assert.deepEqual(full.recipe,e.recipe);assert.deepEqual(full.portion.nutrition,e.portion.nutrition);
});
test('Opschonen en JSON rondreis behouden de volledige receptregistratie',()=>{
 const e=N.fromRecipe(option(),0.75,'roundtrip');
 assert.deepEqual(N.cleanEntry(clone(e)),e);
});
test('Oude registraties krijgen geen verzonnen receptversie of portiegrootte',()=>{
 const e=N.cleanEntry(legacy());assert.equal(e.recipe,undefined);assert.equal(e.portion,undefined);
 const p=N.portionOf(e);assert.equal(p.quantity,1);assert.match(p.label,/volledige opgeslagen maaltijd/);
 const half=N.adjustedEntry(e,{quantity:0.5,title:e.title,nutrition:N.scaleNutrition(p.nutrition,0.5)});
 assert.equal(half.nutrition.kcal,180.5);assert.equal(half.nutrition.fiberG,null);assert.equal(half.recipe,undefined);
});
test('Ongeldige metadata, porties en niet overeenkomende totalen worden geweigerd',()=>{
 const e=N.fromRecipe(option(),1,'invalid');
 for(const quantity of [0,-1,0.1,0.3,21,Infinity,NaN])assert.throws(()=>N.fromRecipe(option(),quantity,'x'));
 assert.throws(()=>N.cleanEntry({...e,recipe:{...e.recipe,version:0}}));
 assert.throws(()=>N.cleanEntry({...e,recipe:{...e.recipe,id:'../secret'}}));
 assert.throws(()=>N.cleanEntry({...e,portion:{...e.portion,label:''}}));
 assert.throws(()=>N.cleanEntry({...e,nutrition:{...e.nutrition,kcal:1}}));
 assert.throws(()=>N.fromRecipe({...option(),nutrition:{...nutrition,kcal:1500}},20,'limit'),/voedingslimiet/);
});

// Voer het echte dagboekscript uit met controleerbare opslag en DOM-gebeurtenissen.
function app(data=diary()){
 const elements={},events={};let hooks,saved=null,allow=true,writes=0;
 const el=id=>{
  if(elements[id])return elements[id];
  let value='';const n={id,hidden:false,checked:false,disabled:false,readOnly:false,style:{},dataset:{},
   textContent:'',innerHTML:'',classList:{toggle(){},contains(){return false;}},
   addEventListener(type,fn){(events[id]??={})[type]=fn;},setAttribute(){},querySelectorAll(){return [];},
   focus(){},scrollIntoView(){},reset(){}};
  Object.defineProperty(n,'value',{get:()=>value,set:x=>{value=String(x);}});
  elements[id]=n;return n;
 };
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[DATE+'T12:00:00Z']));}}
 const sandbox={window:{CookbookNutrition:N,CookbookCloud:{enabled:true,
  start(h){hooks=h;h.onData(clone(data));},enqueue(value){if(!allow)return false;saved=clone(value);writes++;return true;}},confirm(){return true;}},
  document:{getElementById:el},location:{search:'',hash:''},
  localStorage:{getItem(){return null;},setItem(){},removeItem(){}},fetch:async()=>({ok:true,json:async()=>[]}),
  Date:FixedDate,URLSearchParams,JSON,Math,Error,Number,String,Promise,setTimeout(){return 0;}};
 const script=fs.readFileSync(path.join(root,'voeding.html'),'utf8').match(/<script>\s*'use strict';([\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(script,sandbox,{timeout:2000});
 const event=(id,type)=>events[id][type]({preventDefault(){}});
 return {el,event,get saved(){return saved;},get writes(){return writes;},get state(){return clone(hooks.getState());},
  allow(value){allow=value;},replace(value){hooks.onData(clone(value));},logout(){hooks.onLogout();},
  open(id){events.entries.click({target:{closest(){return {dataset:{edit:id},hasAttribute:name=>name==='data-edit'};}}});},
  submit(){event('editEntryForm','submit');},
  quantity(value){el('editEntryQty').value=value;event('editEntryQty','input');}};
}
test('Handmatige maaltijd verplaatsen en halveren behoudt ID en onbekende macrovelden',()=>{
 const a=app();a.open('manual');a.quantity(0.5);a.el('editEntryDate').value=OTHER;a.submit();
 assert.equal(a.saved.days[DATE],undefined);
 const e=a.saved.days[OTHER][0];assert.equal(e.id,'manual');assert.equal(e.nutrition.kcal,180.5);
 assert.equal(e.nutrition.fiberG,null);assert.equal(e.portion.quantity,0.5);
 assert.equal(a.el('selectedDate').value,OTHER);assert.equal(a.el('editEntryPanel').hidden,true);
});
test('Handmatige voedingscorrectie blijft correct bij daarna gekozen hoeveelheid',()=>{
 const a=app();a.open('manual');a.el('editEntryKcal').value='400';a.event('editEntryKcal','input');
 a.quantity(0.5);assert.equal(a.el('editEntryKcal').value,'200');a.submit();
 assert.equal(a.saved.days[DATE][0].nutrition.kcal,200);assert.equal(a.saved.days[DATE][0].portion.nutrition.kcal,400);
});
test('Mislukte opslag bij verplaatsen behoudt dagboek én ingevuld formulier',()=>{
 const before=diary(),a=app(before);a.open('manual');a.quantity(0.5);a.el('editEntryDate').value=OTHER;
 a.allow(false);a.submit();assert.deepEqual(a.state,before);assert.equal(a.saved,null);
 assert.equal(a.el('editEntryPanel').hidden,false);assert.equal(a.el('editEntryDate').value,OTHER);
 assert.equal(a.el('editEntryQty').value,'0.5');assert.match(a.el('status').textContent,/niet opgeslagen/);
 a.allow(true);a.submit();assert.equal(a.saved.days[OTHER].length,1);
});
test('Volle bestemmingsdag en ongeldige datum laten de oorspronkelijke registratie intact',()=>{
 const before=diary();before.days[OTHER]=Array.from({length:100},(_,i)=>({...manual(),id:'other-'+i}));
 const a=app(before);a.open('manual');a.el('editEntryDate').value=OTHER;a.submit();
 assert.deepEqual(a.state,before);assert.equal(a.saved,null);
 a.el('editEntryDate').value='2026-02-30';a.submit();assert.deepEqual(a.state,before);
 assert.match(a.el('status').textContent,/geldige datum/);
});
test('Gelijktijdig gewijzigde registratie wordt niet overschreven met een oud formulier',()=>{
 const a=app();a.open('manual');a.quantity(0.5);
 const newer=diary();newer.days[DATE][0].nutrition.kcal=500;a.replace(newer);a.submit();
 assert.equal(a.writes,0);assert.equal(a.state.days[DATE][0].nutrition.kcal,500);
 assert.match(a.el('status').textContent,/intussen gewijzigd/);
});
test('Verplaatsen maakt geen dubbele identiteit als een import hetzelfde ID bevat',()=>{
 const before=diary();before.days[OTHER]=[{...manual(),title:'Eerdere geïmporteerde lunch'}];
 const a=app(before);a.open('manual');a.el('editEntryDate').value=OTHER;a.submit();
 assert.deepEqual(a.state,before);assert.equal(a.saved,null);assert.match(a.el('status').textContent,/hetzelfde kenmerk/);
});
test('Annuleren en uitloggen kunnen geen wijziging achteraf opslaan',()=>{
 const a=app();a.open('manual');a.quantity(2);a.el('editEntryCancel').onclick();a.submit();
 assert.equal(a.writes,0);assert.equal(a.state.days[DATE][0].nutrition.kcal,361);
 a.open('manual');a.logout();a.submit();assert.equal(a.writes,0);assert.equal(a.el('editEntryPanel').hidden,true);
});
test('Automatische maaltijd verplaatsen bevestigt zonder de oude werkdag opnieuw te vullen',()=>{
 const before=diary([{...manual(),source:'preset',presetSlot:'lunch',confirmed:false}]);
 before.weekdayApplied[DATE]=['lunch'];const a=app(before);a.open('manual');a.el('editEntryDate').value=OTHER;a.submit();
 assert.equal(a.saved.days[OTHER][0].confirmed,true);assert.equal(a.saved.days[OTHER][0].adjusted,true);
 assert.deepEqual(a.saved.weekdayApplied[DATE],['lunch']);assert.deepEqual(a.saved.weekdayApplied[OTHER],['lunch']);
});
test('Recept aanpassen gebruikt de historische waarden en blokkeert directe wijziging daarvan',()=>{
 const e=N.fromRecipe(option(),0.5,'recipe'),a=app(diary([e]));a.open('recipe');
 assert.equal(a.el('editEntryKcal').readOnly,true);a.quantity(1);a.el('editEntryKcal').value='1';a.submit();
 assert.equal(a.saved.days[DATE][0].nutrition.kcal,745);assert.deepEqual(a.saved.days[DATE][0].recipe,e.recipe);
});
