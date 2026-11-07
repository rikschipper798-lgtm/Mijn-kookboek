'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const CookbookPantry=require('../pantry.js');
const root=path.resolve(__dirname,'..');
const recipes=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,'Inline kookboekscript ontbreekt');
const code=match[1];
const canonical=name=>String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),values:m};};
const create=store=>CookbookPantry.create(store,'mijn-kookboek-voorraad',canonical);
test('36 standaardvoorraadproducten uit het keukenprofiel',()=>{
 const p=create(storage()),items=p.get();
 assert.equal(items.length,36);assert.equal(items.filter(x=>x.have).length,36);
 assert.ok(items.some(x=>x.name==='Tomatenpuree'));
 assert.ok(items.some(x=>x.name==='Komijnzaad'));
 assert.ok(items.some(x=>x.name==='Zonnebloemolie'));
});
test('Verse kruiden worden niet met gedroogde kruiden verward',()=>{
 const p=create(storage());
 assert.equal(p.isHome('Gedroogde basilicum'),true);
 assert.equal(p.isHome('Verse basilicum'),false);
 assert.equal(p.isHome('Verse peterselie'),false);
 assert.equal(p.isHome('Peterselie (gedroogd)'),true);
 assert.equal(p.isHome('Komijn'),false);
 assert.equal(p.isHome('Komijnzaad'),true);
});
test('Voorraad aan- en uitzetten blijft bewaard',()=>{
 const store=storage(),p=create(store);
 assert.equal(p.set('olijfolie',false),true);
 assert.equal(p.isHome('Olijfolie'),false);
 assert.equal(create(store).isHome('Olijfolie'),false);
 assert.equal(p.set('olijfolie',true),true);
 assert.equal(create(store).isHome('Olijfolie'),true);
});
test('Zelf toevoegen, dubbele naam voorkomen en weer verwijderen',()=>{
 const store=storage(),p=create(store);
 assert.equal(p.add(' Havermout ').ok,true);
 assert.equal(p.isHome('havermout'),true);
 assert.equal(p.add('HAVERMOUT').ok,true);
 assert.equal(p.get().filter(x=>x.id==='havermout').length,1);
 assert.equal(p.remove('havermout'),true);
 assert.equal(p.isHome('Havermout'),false);
 assert.equal(create(store).isHome('Havermout'),false);
});
test('Herstellen zet oorspronkelijke voorraad terug',()=>{
 const p=create(storage());
 p.set('rijst',false);p.add('Havermout');
 const changed=p.reset();
 assert.ok(changed.includes('havermout'));
 assert.equal(p.get().length,36);assert.equal(p.isHome('Rijst'),true);
 assert.equal(p.isHome('Havermout'),false);
});
test('Beschadigde en kwaadaardige voorraaddata worden afgekeurd',()=>{
 const p=create(storage());
 const bad=p.get();bad[0].name='<script>alert(1)</script>';assert.throws(()=>p.validate(bad));
 const duplicate=p.get();duplicate.push({...duplicate[0]});assert.throws(()=>p.validate(duplicate));
 const proto=p.get();proto[0]={id:'__proto__',name:'__proto__',have:true,group:'Zelf toegevoegd'};
 assert.throws(()=>p.validate(proto));
});
test('Onleesbare opslag levert veilig de beginvoorraad',()=>{
 const store=storage();store.setItem('mijn-kookboek-voorraad','geen json');
 assert.equal(create(store).get().length,36);
});
function appBrowser(){
 const entries=new Map(),store=storage();
 function el(id){
  if(entries.has(id))return entries.get(id);
  let markup='',children=new Map();
  const x={
   id,hidden:false,checked:false,value:'',textContent:'',dataset:{},style:{},
   classList:{add(){},remove(){},toggle(){}},
   add(){},addEventListener(type,fn){this['on'+type]=fn;},setAttribute(){},
   contains(y){return y===this;},focus(){},scrollIntoView(){},
   querySelectorAll(selector){
    if(id!=='basket')return [];
    if(children.has(selector))return children.get(selector);
    const patterns={
     '[data-house]':[/data-house="([^"]+)"/g,'house'],
     '[data-pantry-id]':[/data-pantry-id="([^"]+)"/g,'pantryId'],
     '[data-pantry-remove]':[/data-pantry-remove="([^"]+)"/g,'pantryRemove']
    };
    const v=patterns[selector];if(!v)return [];
    const controls=[...markup.matchAll(v[0])].map(m=>({
     dataset:{[v[1]]:m[1]},checked:!!m[0].includes(' checked'),
     onclick:null,onchange:null
    }));
    children.set(selector,controls);
    return controls;
   }
  };
  Object.defineProperty(x,'innerHTML',{get:()=>markup,set:v=>{markup=String(v);children=new Map()}});
  entries.set(id,x);return x;
 }
 const document={
  getElementById:el,querySelectorAll:()=>[],querySelector:()=>el('none'),addEventListener(){},
  title:'',visibilityState:'visible',
  body:{classList:{add(){},remove(){}},appendChild(){}},
  createElement:()=>({click(){},remove(){}})
 };
 const location={hash:'',href:''},navigator={onLine:true};
 const window={location,navigator,CookbookPantry,isSecureContext:false,matchMedia:()=>({matches:false}),
  addEventListener(){},confirm:()=>true,scrollTo(){},print(){}};
 const script=new Function('document','window','navigator','localStorage','location','fetch','Option','setInterval','clearInterval','queueMicrotask','setTimeout',
  code+'\nreturn {refreshRecipeCollection,route,renderBasket,basketItems,isAlreadyHome,backupData,validBackup,getBasket:()=>basket,pantry};');
 const api=script(document,window,navigator,store,location,async()=>({ok:true,json:async()=>recipes}),
  function Option(t,v){this.text=t;this.value=v;},()=>0,()=>{},cb=>cb(),()=>0);
 return {api,el,store,location,
  async ready(){await api.refreshRecipeCollection();},
  add(id){
   location.hash='#recept/'+id;api.route();el('addBasket').onclick();
   location.hash='#boodschappenlijst';api.route();
  },
  row(name){return api.basketItems().find(x=>x.name===name)}
 };
}
test('Boodschappenlijst herkent olie uit standaardvoorraad',async()=>{
 const b=appBrowser();await b.ready();b.add('bruschetta');
 const olive=b.row('Olijfolie'),basil=b.row('Verse basilicum');
 assert.ok(olive);assert.ok(basil);
 assert.equal(b.api.isAlreadyHome(olive),true);
 assert.equal(b.api.isAlreadyHome(basil),false);
 assert.match(b.el('basket').innerHTML,/Mijn standaardvoorraad/);
 assert.match(b.el('basket').innerHTML,/Standaardvoorraad · controleer hoeveelheid/);
});
test('Receptnamen voor rijst en pasta worden genormaliseerd',async()=>{
 const b=appBrowser();await b.ready();b.add('piripiri');
 const rice=b.api.basketItems().find(x=>x.pantryId==='rijst');
 assert.ok(rice);assert.equal(b.api.isAlreadyHome(rice),true);
 b.add('pasta-rundergehakt-groenten');
 const pasta=b.api.basketItems().find(x=>x.pantryId==='pasta');
 assert.ok(pasta);assert.equal(b.api.isAlreadyHome(pasta),true);
});
test('Toch kopen is een expliciete uitzondering op standaardvoorraad',async()=>{
 const b=appBrowser();await b.ready();b.add('bruschetta');
 const before=b.row('Olijfolie');
 const control=b.el('basket').querySelectorAll('[data-house]').find(x=>x.dataset.house===before.key);
 assert.ok(control);control.onclick();
 assert.equal(b.api.isAlreadyHome(b.row('Olijfolie')),false);
 assert.equal(JSON.parse(b.store.getItem('mijn-kookboek-boodschappenchecks'))['al-in-huis:'+before.key],false);
});
test('Voorraad aanpassen wist eerdere uitzondering en verplaatst producten automatisch',async()=>{
 const b=appBrowser();await b.ready();b.add('bruschetta');
 const row=b.row('Olijfolie');
 b.el('basket').querySelectorAll('[data-house]').find(x=>x.dataset.house===row.key).onclick();
 assert.equal(b.api.isAlreadyHome(row),false);
 let input=b.el('basket').querySelectorAll('[data-pantry-id]').find(x=>x.dataset.pantryId==='olijfolie');
 input.checked=false;input.onchange();
 assert.equal(b.api.isAlreadyHome(b.row('Olijfolie')),false);
 input=b.el('basket').querySelectorAll('[data-pantry-id]').find(x=>x.dataset.pantryId==='olijfolie');
 input.checked=true;input.onchange();
 assert.equal(b.api.isAlreadyHome(b.row('Olijfolie')),true);
});
test('Boodschappen voor gekochte kruidenboter blijven los van eigen voorraad',async()=>{
 const b=appBrowser();await b.ready();b.add('gevuld-kruidenboterstokbrood-kaas-oregano');
 const entry=b.api.getBasket()['gevuld-kruidenboterstokbrood-kaas-oregano:klassiek'];
 entry.componentModes={'1':'buy'};
 b.api.renderBasket();
 assert.ok(b.row('Kruidenboter (kant-en-klaar)'));
 assert.equal(b.api.isAlreadyHome(b.row('Kruidenboter (kant-en-klaar)')),false);
});
test('Nieuwe back-up bevat voorraad en oude back-up behoudt bestaande voorraad',async()=>{
 const b=appBrowser();await b.ready();const data=b.api.backupData();
 assert.equal(data.pantry.length,36);
 const valid={app:'mijn-kookboek',version:1,exportedAt:new Date().toISOString(),data};
 const parsed=b.api.validBackup(valid);
 assert.equal(parsed.data.pantry.length,36);
 const old={...data};delete old.pantry;
 const legacy=b.api.validBackup({...valid,data:old});
 assert.equal(legacy.data.pantry,null);
});
test('Bewerkte voorraad wordt veilig uit nieuwe back-up gelezen',async()=>{
 const b=appBrowser();await b.ready();
 const data=b.api.backupData();data.pantry[0].have=false;
 const parsed=b.api.validBackup({app:'mijn-kookboek',version:1,exportedAt:new Date().toISOString(),data});
 assert.equal(parsed.data.pantry[0].have,false);
 data.pantry[0].id='ander-product';
 assert.throws(()=>b.api.validBackup({app:'mijn-kookboek',version:1,exportedAt:new Date().toISOString(),data}));
});
