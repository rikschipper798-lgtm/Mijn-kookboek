'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const scaling=require('../recipe-scaling.js');
const {validateRecipes}=require('../scripts/validate-recipes.cjs');
const catalog=require('../recepten.json');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const view=(id,variant)=>{const recipe=catalog.find(r=>r.id===id);return {...recipe,...recipe.variants?.find(v=>v.id===variant)};};
// Exercise the real app wrappers shared by recipe details, cook mode and export.
const slice=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to));
const source=slice('function scalingIngredients(', 'function isFixedPerServingAmount(')+
 slice('function recipeText(', 'async function copyText(')+
 slice('function cookSteps(', '/* Toon de keukentimer');
const ui=new Function('window','fmtQty','portions','allIngredients','amount','title','portionsLabel','recipeVersion','revisionDateLabel',source+'\nreturn {scaledStepBody,cookSteps,recipeText};')(
 {CookbookScaling:scaling},scaling.formatQty,r=>r.servings,r=>r.ingredients,
 (i,m)=>i.qty===null?'naar smaak':scaling.formatQty(scaling.ingredientQty(i,m),i.unit)+' '+i.unit,
 r=>r.title,(r,n)=>n+' personen',r=>r.version,x=>x
);
const render=(id,step,servings,variant)=>{const v=view(id,variant);return ui.scaledStepBody(v,v.steps[step],servings/v.servings);};

test('Elke hoeveelheid heeft een geldige expliciete bron; alle receptversies zijn gemigreerd',()=>{
 assert.ok(catalog.length>0);
 let versions=0;
 for(const r of catalog)for(const v of [r,...r.variants||[]]){
  const current={...r,...v};versions++;
  for(const step of current.steps)assert.deepEqual(scaling.validateStep(current,step),[],v.id+': '+step.title);
 }
 assert.equal(versions,catalog.reduce((sum,r)=>sum+1+(r.variants?.length||0),0));
});
for(const r of catalog)for(const variant of [null,...r.variants||[]]){
 const current={...r,...variant};
 test(current.id+': oorspronkelijke tekst, kookmodus en export blijven consistent voor 1, 2, 3, 4 en 6 porties',()=>{
  for(const step of current.steps)assert.equal(ui.scaledStepBody(current,step,1),step.body);
  for(const servings of [1,2,3,4,6]){
   const mult=servings/current.servings,exported=ui.recipeText(current,mult),cooking=ui.cookSteps(current,mult);
   for(const [index,step] of current.steps.entries()){
    const text=ui.scaledStepBody(current,step,mult);
    assert.equal(cooking[index].body,text);
    assert.ok(exported.includes(text));
    assert.doesNotMatch(text,/NaN|undefined|Infinity/);
    // Durations, heat settings, dimensions and fixed quantities are untouched.
    for(const match of step.body.matchAll(/\d+(?:[.,]\d+)?(?:[–-]\d+(?:[.,]\d+)?)?\s*(?:°C|cm|mm|minuten|seconden|uur)\b/g))assert.ok(text.includes(match[0]),match[0]);
    for(const ref of step.quantityRefs.filter(x=>x.fixed))assert.ok(text.includes(ref.text),ref.text);
   }
  }
 });
}
for(const variant of [undefined,'poesta'])for(const servings of [1,2,4,6]){
 test('Saucijzenbroodjes '+(variant||'klassiek')+' voor '+servings+' personen: deeg en vulling leveren hetzelfde aantal',()=>{
  const v=view('klassieke-saucijzenbroodjes',variant),doughStep=variant?4:0,shapeStep=variant?6:4;
  assert.equal(scaling.ingredientQty(v.ingredients[0],servings/2),servings*2);
  assert.match(render(v.id==='poesta'?'klassieke-saucijzenbroodjes':v.id,doughStep,servings,variant),new RegExp(servings*2+' plakjes'));
  assert.match(render('klassieke-saucijzenbroodjes',shapeStep,servings,variant),new RegExp(servings*2+' gelijke porties'));
 });
}
test('Kofta: vormen, bakken en serveren schalen samen; drie per persoon blijft vast',()=>{
 const id='runderkofta-flatbread-knoflook-yoghurtsaus';
 assert.match(render(id,0,4),/12 gelijke porties/);
 assert.match(render(id,3,4),/12 kofta's/);
 assert.match(render(id,5,4),/12 kofta's \(drie per persoon\)/);
 assert.match(render(id,3,4),/stand 7 van 9/);
});
test('Verdeelde ingrediënten behouden hun verhouding en tellen op tot het totaal',()=>{
 assert.match(render('chocolademelk',0,4),/6 el \(90 ml\)/);
 assert.match(render('chocolademelk',2,4),/910 ml melk/);
 assert.match(render('vlaams-stoofvlees',3,4),/200 ml van de 600 ml/);
 assert.match(render('vlaams-stoofvlees',3,4),/400 ml bier/);
 assert.match(render('hutspot-rookworst-spek-gebakken-ui',0,4),/500 g uien 150 g grof en de overige 350 g/);
 assert.match(render('gyros',0,4),/Rasp ½ komkommer/);
 assert.match(render('gyros',0,4),/de andere ½ in dunne plakjes/);
});
test('Aperol: totalen schalen, hoeveelheden per glas niet',()=>{
 assert.match(render('aperol-spritz',1,4),/4 grote wijnglazen.*100 g ijsblokjes/);
 assert.match(render('aperol-spritz',2,4),/360 ml prosecco.*90 ml per glas/);
 assert.match(render('aperol-spritz',3,4),/60 ml Aperol in elk glas \(240 ml in totaal\)/);
 assert.match(render('aperol-spritz',4,4),/30 ml bruiswater.*120 ml in totaal/);
});
test('Vaste maten: burgers, paneerborden, mosterd per filet, ramequins en stoomwater',()=>{
 assert.match(render('hamburgers',1,4),/4 gelijke porties van 150 g/);
 assert.match(render('klassieke-krokante-kip-cordon-bleu',2,4),/drie diepe borden/);
 assert.match(render('klassieke-krokante-kip-cordon-bleu',1,4),/iedere kipfilet eventueel met ½ tl Dijonmosterd/);
 assert.match(render('chocolade-lavacake-pure-chocolade',0,4),/4 ovenbestendige ramequins.*150 ml/);
 assert.match(render('stokbrood',8,6),/150 ml heet water/);
 assert.equal(scaling.ingredientQty(view('stokbrood').ingredients[4],3),150);
 assert.match(render('stokbrood',4,4),/4 gelijke stukken/);
});
test('Eieren voor lavacake: afgeronde inkopen en afgewogen beslag bij oneven porties',()=>{
 for(const variant of [undefined,'melkchocolade']){
  const id='chocolade-lavacake-pure-chocolade',v=view(id,variant);
  assert.equal(scaling.ingredientQty(v.ingredients[2],.5),2);
  assert.equal(scaling.ingredientQty(v.ingredients[2],1.5),4);
  assert.match(render(id,2,1,variant),/25 g af.*9 g eidooier/);
  assert.match(render(id,2,3,variant),/75 g af.*27 g eidooier/);
  assert.match(render(id,2,4,variant),/Neem 4 eieren: gebruik 2 hele eieren.*dooiers van 2 andere eieren/);
 }
});
test('Eenheden en aantallen: enkelvoud, meervoud en bereik met duizendtalscheiding',()=>{
 assert.match(render('broodje-crispy-kipschnitzel-sriracha-mayo',0,1),/1 dunne schnitzel/);
 assert.match(render('gekruide-kipschnitzel',3,4),/2 losgeklopte eieren/);
 assert.match(render('gevuld-kruidenboterstokbrood-kaas-oregano',0,4),/2 afbakstokbroden/);
 assert.match(render('bruschetta',0,10),/550 g rijpe tomaten/);
 assert.match(render('bruschetta',1,10),/25–30 plakjes/);
});
test('Ongeldige, verouderde, dubbele en overlappende koppelingen worden afgekeurd',()=>{
 const current=view('klassieke-saucijzenbroodjes');
 const check=step=>scaling.validateStep(current,step).join('\n');
 let step=clone(current.steps[0]);delete step.quantityRefs;assert.match(check(step),/quantityRefs ontbreekt/);
 step=clone(current.steps[0]);step.quantityRefs[0].ingredientIndex=999;assert.match(check(step),/ongeldige ingrediëntbron/);
 step=clone(current.steps[0]);step.body=step.body.replace('4 plakjes','5 plakjes');assert.match(check(step),/tekstanker niet gevonden/);
 step=clone(current.steps[0]);step.quantityRefs.push(clone(step.quantityRefs[0]));assert.match(check(step),/overlappende/);
 step=clone(current.steps[0]);step.quantityRefs[0].factor=2;assert.match(check(step),/basishoeveelheid/);
 step=clone(current.steps[0]);step.quantityRefs[0].perServing=2;assert.match(check(step),/precies één bron/);
 step=clone(current.steps[0]);step.body+=' Voeg 10 g boter toe.';assert.match(check(step),/zonder expliciete koppeling/);
});
test('Catalogusvalidatie wijst ontbrekende koppelingen ook voor varianten af',()=>{
 const data=clone(catalog),v=data.find(r=>r.id==='klassieke-saucijzenbroodjes').variants[0];
 delete v.steps[0].quantityRefs;
 const result=validateRecipes(data,{existsFile:()=>true});
 assert.match(result.errors.join('\n'),/variants\[0\].*quantityRefs ontbreekt/);
});
test('Nieuwe module is beschikbaar voor de app en offline',()=>{
 assert.ok(html.indexOf('src="./recipe-scaling.js')<html.indexOf('<script>'));
 const worker=fs.readFileSync(require.resolve('../sw.js'),'utf8');
 assert.match(worker,/CORE_ASSETS=.*'recipe-scaling.js'/);
 assert.match(worker,/pathname==='recipe-scaling.js'/);
});
