'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {validateRecipes}=require('../scripts/validate-recipes.cjs');
const {checkChanges}=require('../scripts/check-recipe-revisions.cjs');
const {bumpRecipe}=require('../scripts/bump-recipe-version.cjs');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const clone=()=>JSON.parse(JSON.stringify(catalog));
const check=other=>validateRecipes(other,{rootDir:root});
const sample=()=>{
 const r=clone()[0];
 r.subtitle+=' Nieuwe informatie.';
 r.version=2;r.updatedAt='2026-11-07';
 r.changeLog=[{version:2,date:'2026-11-07',description:'Bereiding en kruidenbalans aangepast.'}];
 return r;
};
const candidate=()=>{const c=clone();c[0]=sample();return c;};
function mustReject(name,edit,pattern){
 test(name,()=>{
  const copy=clone();edit(copy);
  assert.match(check(copy).errors.join('\n'),pattern);
 });
}
const before=html.indexOf('function recipeVersion(');
const after=html.indexOf('function timeInfo(',before);
assert.ok(before!==-1&&after>before,'Versiefuncties ontbreken in website');
const source=html.slice(before,after);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=new Function('safe',source+'\nreturn {recipeVersion,revisionDateLabel,latestRevisionDate,hasRecordedChanges,recipeRevisionMeta,revisionHistory};')(escape);

test('Alle 27 recepten en 2 varianten beginnen als gecontroleerde versie 1',()=>{
 assert.equal(catalog.length,27);
 const variants=catalog.flatMap(r=>r.variants||[]);
 assert.equal(variants.length,2);
 for(const r of [...catalog,...variants]){
  assert.equal(r.version,1);
  assert.equal(r.updatedAt,null);
  assert.deepEqual(r.changeLog,[]);
 }
 assert.deepEqual(check(catalog).errors,[]);
});
test('Bestaande opnamedatums blijven behouden',()=>{
 assert.equal(catalog.find(x=>x.id==='bruschetta').date,'2026-10-14');
 assert.equal(catalog.find(x=>x.id==='gevuld-kruidenboterstokbrood-kaas-oregano').date,'2026-11-07');
});
test('Een geldige tweede versie wordt geaccepteerd',()=>{
 const next=candidate();
 assert.deepEqual(check(next).errors,[]);
 assert.deepEqual(checkChanges(catalog,next),[]);
});
test('Datums en versiegegevens verschijnen in het juiste Nederlands',()=>{
 assert.equal(ui.revisionDateLabel('2026-11-07'),'7 november 2026');
 const r=sample();
 assert.match(ui.recipeRevisionMeta(r),/Versie 2/);
 assert.match(ui.recipeRevisionMeta(r),/Bijgewerkt 7 november 2026/);
 assert.match(ui.revisionHistory(r),/Bereiding en kruidenbalans aangepast/);
 assert.match(ui.revisionHistory(r),/Opgenomen/);
});
test('Geschiedenis van eerste versie heeft geen gefingeerde revisies',()=>{
 const initial=ui.revisionHistory(catalog[0]);
 assert.match(initial,/Huidige versie:<\/strong> 1/);
 assert.match(initial,/Eerdere aanpassingen zijn niet apart gedocumenteerd/);
 assert.doesNotMatch(initial,/<li>/);
});
test('Bij variant staat de versie van de variant zelf',()=>{
 const parent=catalog.find(x=>x.id==='pasta-rundergehakt-groenten');
 const variant=parent.variants[0];
 const view={...parent,...variant,title:parent.title+' — '+variant.label};
 assert.equal(ui.recipeVersion(view),1);
 assert.equal(ui.revisionDateLabel(view.date),'28 oktober 2026');
});
test('Wijzigingsomschrijvingen worden veilig als tekst getoond',()=>{
 const r=sample();r.changeLog[0].description='Bereiding verbeterd, <script>alert("x")</script>';
 const result=ui.revisionHistory(r);
 assert.match(result,/&lt;script&gt;/);
 assert.doesNotMatch(result,/<script>/);
});
test('Nieuwste recept en recent gewijzigd blijven afzonderlijke sorteerkeuzes',()=>{
 assert.match(html,/value="newest">Recent toegevoegd/);
 assert.match(html,/value="recently-updated">Recent gewijzigd/);
 assert.equal(ui.latestRevisionDate(catalog[0]),catalog[0].date);
 assert.equal(ui.latestRevisionDate(sample()),'2026-11-07');
});
mustReject('Een ontbrekend versienummer wordt afgekeurd',d=>{delete d[0].version;},/versie moet/);
mustReject('Versie 1 mag geen fictieve wijzigingsdatum hebben',d=>{d[0].updatedAt='2026-11-07';},/versie 1 is de historische beginversie/);
mustReject('Versie 2 vereist een beschrijving',d=>{d[0]=sample();d[0].changeLog[0].description='Kort';},/omschrijving/);
mustReject('Versie 2 vereist precies één logregel',d=>{d[0].version=2;d[0].updatedAt='2026-11-07';},/precies één wijzigingsregel/);
mustReject('Versie 3 vereist geschiedenis van versie 2 en 3',d=>{
 d[0]=sample();d[0].version=3;d[0].updatedAt='2026-11-07';
},/precies één wijzigingsregel/);
mustReject('Wijziging vóór de opnamedatum wordt afgekeurd',d=>{
 d[0]=sample();d[0].changeLog[0].date='2026-10-01';d[0].updatedAt='2026-10-01';
},/opnamedatum/);
mustReject('Laatste wijzigingsdatum en logregel moeten gelijk zijn',d=>{
 d[0]=sample();d[0].updatedAt='2026-11-06';
},/nieuwste wijzigingsregel/);
mustReject('Volgorde van revisies moet oplopend zijn',d=>{
 d[0]=sample();d[0].changeLog[0].version=5;
},/revisies moeten oplopend/);
mustReject('Variant zonder geldig versienummer wordt afgekeurd',d=>{
 d.find(x=>x.variants?.length).variants[0].version=0;
},/versie moet/);
test('Een stille inhoudelijke wijziging zonder versieverhoging wordt geblokkeerd',()=>{
 const d=clone();d[0].subtitle+=' extra informatie';
 assert.match(checkChanges(catalog,d).join('\n'),/verhoog versienummer/);
});
test('Een lege versieverhoging wordt geblokkeerd',()=>{
 const d=clone();d[0].version=2;d[0].updatedAt='2026-11-07';
 d[0].changeLog=[{version:2,date:'2026-11-07',description:'Alleen metadata gewijzigd.'}];
 assert.match(checkChanges(catalog,d).join('\n'),/inhoud niet veranderd/);
});
test('Een wijziging aan geërfde velden geldt ook voor varianten',()=>{
 const d=clone(),r=d.find(x=>x.variants?.length);
 r.title+=' vernieuwd';r.version=2;r.updatedAt='2026-11-07';
 r.changeLog=[{version:2,date:'2026-11-07',description:'Titel van het gerecht aangepast.'}];
 assert.match(checkChanges(catalog,d).join('\n'),/::romig/);
});
test('Eigen wijziging aan een variant verplicht alleen die variant tot een nieuw versienummer',()=>{
 const d=clone(),r=d.find(x=>x.variants?.length);r.variants[0].label+=' verbeterd';
 const errors=checkChanges(catalog,d);
 assert.ok(errors.some(x=>x.includes('::romig')));
 assert.ok(!errors.some(x=>x.startsWith(r.id+': ')));
});
test('Een nieuw recept begint op versie 1',()=>{
 const d=clone(),newRecipe=JSON.parse(JSON.stringify(d[0]));
 newRecipe.id='geheel-nieuw-recept';newRecipe.date='2026-11-07';
 newRecipe.version=1;newRecipe.updatedAt=null;newRecipe.changeLog=[];d.push(newRecipe);
 assert.deepEqual(checkChanges(catalog,d),[]);
});
test('Eerdere wijzigingsregels mogen bij versie 3 niet worden aangepast',()=>{
 const old=candidate(),d=JSON.parse(JSON.stringify(old));
 d[0].subtitle+=' nog een verbetering';d[0].version=3;d[0].updatedAt='2026-11-07';
 d[0].changeLog[0].description='Achteraf gewijzigde tekst voor oude versie';
 d[0].changeLog.push({version:3,date:'2026-11-07',description:'De bereiding opnieuw verder uitgewerkt.'});
 assert.match(checkChanges(old,d).join('\n'),/bestaande wijzigingsregels mogen niet worden aangepast/);
});

test('Revisiehulpmiddel verhoogt versie en registreert datum en omschrijving',()=>{
 const d=clone();
 const details=bumpRecipe(d,d[0].id,'Ingrediënten en bereidingswijze verder verbeterd.',{date:'2026-11-07'});
 assert.equal(details.version,2);
 assert.equal(d[0].updatedAt,'2026-11-07');
 assert.deepEqual(d[0].changeLog,[{version:2,date:'2026-11-07',
  description:'Ingrediënten en bereidingswijze verder verbeterd.'}]);
 assert.equal(catalog[0].version,1);
});
test('Revisiehulpmiddel kan een variant onafhankelijk verhogen',()=>{
 const d=clone(),r=d.find(x=>x.variants?.length);
 const result=bumpRecipe(d,r.id,'De romige saus wat rijker en milder gemaakt.',{
  variantId:r.variants[0].id,date:'2026-11-07'
 });
 assert.equal(result.version,2);
 assert.equal(r.version,1);
 assert.equal(r.variants[0].version,2);
});
test('Revisiehulpmiddel weigert onjuiste datum, onbekend recept en te korte tekst',()=>{
 assert.throws(()=>bumpRecipe(clone(),'niet-bestaand','Beschrijving van wijziging.',{date:'2026-11-07'}));
 assert.throws(()=>bumpRecipe(clone(),catalog[0].id,'Kort',{date:'2026-11-07'}));
 assert.throws(()=>bumpRecipe(clone(),catalog[0].id,'Betere ingrediënten toegevoegd.',{date:'2026-02-30'}));
 assert.throws(()=>bumpRecipe(clone(),catalog[0].id,'Betere ingrediënten toegevoegd.',{date:'2020-02-01'}));
});
test('Een gewijzigde variant bepaalt de datum bij recent gewijzigd',()=>{
 const d=clone(),r=d.find(x=>x.variants?.length);
 assert.equal(ui.latestRevisionDate(r),r.date);
 r.variants[0].version=2;
 r.variants[0].updatedAt='2026-11-07';
 r.variants[0].changeLog=[{version:2,date:'2026-11-07',
  description:'De saus en verhoudingen zijn aangescherpt.'}];
 assert.equal(ui.latestRevisionDate(r),'2026-11-07');
 assert.equal(ui.hasRecordedChanges(r),true);
 assert.equal(ui.recipeRevisionMeta(r).includes('Bijgewerkt'),false);
 assert.equal(ui.recipeRevisionMeta({...r,...r.variants[0]}).includes('Bijgewerkt'),true);
});
