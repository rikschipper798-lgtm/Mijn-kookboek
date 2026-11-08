'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const CookbookPantry=require('../pantry.js');

const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=html.match(/<script>\s*'use strict';([\s\S]*?)<\/script>/);
assert.ok(js,'inline app-script ontbreekt');
const localKey='mijn-kookboek-persoonlijke-notities';
const clone=x=>JSON.parse(JSON.stringify(x));
const rawEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function app(initialNotes={}){
 const store=new Map([[localKey,JSON.stringify(initialNotes)]]);
 const elements=new Map();
 const document={
  getElementById:get,
  querySelector:()=>get('top'),
  querySelectorAll:()=>[],
  addEventListener(){},
  title:'Mijn Kookboek',
  visibilityState:'visible',
  body:{classList:{add(){},remove(){}},appendChild(){}},
  createElement:()=>({click(){},remove(){}})
 };
 function get(id){
  if(elements.has(id))return elements.get(id);
  const element={
   id,value:'',textContent:'',checked:false,hidden:false,open:false,dataset:{},style:{},innerHTML:'',
   classList:{add(){},remove(){},toggle(){}},
   setAttribute(name,value){this['attr_'+name]=value;},
   addEventListener(event,listener){this['on'+event]=listener;},
   querySelectorAll(){return [];},
   contains(other){return other===this;},
   focus(options){this.focused=options||true;},
   scrollIntoView(){this.scrolled=true;},
   add(){},
  };
  elements.set(id,element);return element;
 }
 const location={hash:'',href:''},navigator={onLine:true};
 const window={
  location,navigator,CookbookPantry,isSecureContext:false,
  matchMedia:()=>({matches:false}),addEventListener(){},
  confirm:()=>true,scrollTo(){},print(){}
 };
 const localStorage={
  getItem:k=>store.has(k)?store.get(k):null,
  setItem:(k,v)=>store.set(k,v),
  removeItem:k=>store.delete(k)
 };
 const app=new Function('document','window','navigator','localStorage','location','fetch',
  'Option','setInterval','clearInterval','queueMicrotask','setTimeout',
  "'use strict';"+js[1]+"\nreturn {refreshRecipeCollection,renderCards,renderDetail,route,personalCardEntry,personalCardSummary,personalDetailSummary,personalLastCooked,personalCardRating,personalEntries,activeFilters,noteRecord,savePersonalNote,updateExperienceOverview};")(
  document,window,navigator,localStorage,location,
  async()=>({ok:true,json:async()=>catalog}),
  function Option(label,value){this.label=label;this.value=value;},
  ()=>0,()=>{},callback=>callback(),()=>0
 );
 async function ready(){await app.refreshRecipeCollection();}
 function show(id){location.hash='#recept/'+id;app.route();}
 function saveExperience({rating=0,notes='',feedback='',date=null}={}){
  get('recipeRating').value=String(rating);
  get('noteText').value=notes;
  get('feedbackText').value=feedback;
  get('savePersonalNotes').onclick();
  if(date!==null){
   const selected=JSON.parse(store.get(localKey));
   const key=get('detail').dataset.recipeId+':'+get('detail').dataset.variantId;
   selected[key].lastCookedOn=date;
   store.set(localKey,JSON.stringify(selected));
  }
 }
 return {app,store,get,show,ready,saveExperience,location,document};
}
test('Zonder kookervaring toont de kaart geen persoonlijke beoordeling of verzonnen kookdatum',async()=>{
 const b=app();await b.ready();
 assert.doesNotMatch(b.get('cards').innerHTML,/card-experience/);
 b.show('bruschetta');
 assert.match(b.get('detail').innerHTML,/Nog niet beoordeeld/);
 assert.match(b.get('detail').innerHTML,/Nog geen kookdatum/);
 assert.match(b.get('detail').innerHTML,/Beoordeel dit recept/);
});
test('Bestaande notities en beoordelingen staan op de receptenkaart',async()=>{
 const b=app({'bruschetta:klassiek':{
  rating:4,lastCookedOn:'2026-11-05',notes:'Meer basilicum',feedback:'Geslaagd'
 }});
 await b.ready();
 const card=b.get('cards').innerHTML;
 assert.match(card,/MIJN KOOKERVARING/);
 assert.match(card,/4\/5/);
 assert.match(card,/Gekookt 05-11-2026/);
 assert.match(card,/Notities/);
 b.show('bruschetta');
 assert.match(b.get('detail').innerHTML,/4\/5/);
 assert.match(b.get('detail').innerHTML,/Laatst gekookt: 5-11-2026/);
 assert.match(b.get('detail').innerHTML,/Geslaagd/);
 assert.match(b.get('detail').innerHTML,/Meer basilicum/);
});
test('Je kunt de samenvatting bijwerken zonder het invoerformulier opnieuw op te bouwen',async()=>{
 const b=app();await b.ready();b.show('bruschetta');
 const detailBefore=b.get('detail').innerHTML;
 b.saveExperience({rating:5,notes:'Meer zout',feedback:'Heerlijk gerecht'});
 assert.equal(b.get('detail').innerHTML,detailBefore);
 const summary=b.get('experienceOverview').innerHTML;
 assert.match(summary,/5\/5/);
 assert.match(summary,/Heerlijk gerecht/);
 assert.match(summary,/Meer zout/);
 assert.equal(JSON.parse(b.store.get(localKey))['bruschetta:klassiek'].rating,5);
 b.get('jumpExperience').onclick();
 assert.equal(b.get('personalNotes').scrolled,true);
 assert.ok(b.get('feedbackText').focused);
});
test('Feedback in samenvatting is kort en veilig ontsmet',async()=>{
 const malicious='<script>alert("x")</script> '+ 'lange '.repeat(100);
 const b=app({'bruschetta:klassiek':{rating:2,feedback:malicious}});
 await b.ready();b.show('bruschetta');
 const summary=b.get('experienceOverview').innerHTML;
 assert.match(summary,/&lt;script&gt;/);
 assert.doesNotMatch(summary,/<script>/);
 assert.ok(summary.length<950,'feedback in de samenvatting moet worden ingekort');
});
test('Persoonlijke ervaringen blijven gescheiden tussen receptvarianten',async()=>{
 const notes={
  'pasta-rundergehakt-groenten:klassiek':{rating:3,lastCookedOn:'2026-10-24',feedback:'Basis'},
  'pasta-rundergehakt-groenten:romig':{rating:5,lastCookedOn:'2026-11-06',feedback:'Romige variant'}
 };
 const b=app(notes);await b.ready();
 b.show('pasta-rundergehakt-groenten');
 assert.match(b.get('experienceOverview').innerHTML,/Basis/);
 assert.doesNotMatch(b.get('experienceOverview').innerHTML,/Romige variant/);
 b.get('detail').dataset.variantId='romig';
 b.app.renderDetail();
 assert.match(b.get('experienceOverview').innerHTML,/Romige variant/);
 assert.doesNotMatch(b.get('experienceOverview').innerHTML,/>Basis</);
 const card=b.app.personalCardSummary(catalog.find(r=>r.id==='pasta-rundergehakt-groenten'));
 assert.match(card,/romig/i);
 assert.match(card,/5\/5/);
 assert.equal(b.app.personalLastCooked(catalog.find(r=>r.id==='pasta-rundergehakt-groenten')),'2026-11-06');
});
test('Eerder gekookt filtert alleen recepten met een vastgelegde kookdatum',async()=>{
 const b=app({'bruschetta:klassiek':{rating:5},
  'kruidenboter:klassiek':{lastCookedOn:'2026-11-05'}});
 await b.ready();
 b.get('cookedOnly').onclick();
 const list=b.get('cards').innerHTML;
 assert.match(list,/data-recipe="kruidenboter"/);
 assert.doesNotMatch(list,/data-recipe="bruschetta"/);
 assert.equal(b.get('cookedOnly')['attr_aria-pressed'],true);
});
test('Sortering op eigen beoordeling en laatste kookdatum gebruikt lokale gegevens',async()=>{
 const b=app({
  'bruschetta:klassiek':{rating:3,lastCookedOn:'2026-11-07'},
  'kruidenboter:klassiek':{rating:5,lastCookedOn:'2026-11-01'}
 });
 await b.ready();
 b.get('sortRecipes').value='my-rating';b.app.renderCards();
 let cards=b.get('cards').innerHTML;
 assert.ok(cards.indexOf('data-recipe="kruidenboter"')<cards.indexOf('data-recipe="bruschetta"'));
 b.get('sortRecipes').value='last-cooked';b.app.renderCards();
 cards=b.get('cards').innerHTML;
 assert.ok(cards.indexOf('data-recipe="bruschetta"')<cards.indexOf('data-recipe="kruidenboter"'));
});
test('Bij ongekende rating 0 worden geen sterren getoond',async()=>{
 const b=app({'bruschetta:klassiek':{rating:0,feedback:'Nog uitproberen'}});
 await b.ready();
 const card=b.app.personalCardSummary(catalog.find(r=>r.id==='bruschetta'));
 assert.match(card,/Notities/);
 assert.doesNotMatch(card,/0\/5|experience-stars/);
});
test('Persoonlijke notities blijven lokaal en worden niet in recepten.json gezet',()=>{
 assert.equal(catalog.some(r=>r.personalNotes||r.rating||r.lastCookedOn),false);
 assert.match(html,/mijn-kookboek-persoonlijke-notities/);
});
