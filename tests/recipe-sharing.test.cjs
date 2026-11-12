'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const source=html.slice(html.indexOf('function parseRecipeLink('),html.indexOf('function setupRecipeSharing('));
const {parseRecipeLink,recipeShareUrl}=new Function(source+'\nreturn {parseRecipeLink,recipeShareUrl};')();
const root='https://example.test/Mijn-kookboek/';

test('Deellink bewaart hoofdrecept, variant en porties onder het juiste subpad',()=>{
 const url=recipeShareUrl({id:'klassieke-saucijzenbroodjes'},'poesta',4,root+'index.html');
 assert.equal(url,root+'#recept/klassieke-saucijzenbroodjes?variant=poesta&porties=4');
 assert.deepEqual(parseRecipeLink(new URL(url).hash),{id:'klassieke-saucijzenbroodjes',variant:'poesta',servings:4});
});
test('De kerstmenulink opent 18 porties zonder extra variant',()=>{
 const id='kerstmenu-18-personen-ofyr-bavette-varkenshaas';
 assert.equal(recipeShareUrl({id},'klassiek',18,root),root+'#recept/'+id+'?porties=18');
});
test('Deellink neemt geen accountparameters, oude route of persoonlijke gegevens over',()=>{
 const url=recipeShareUrl({id:'zalm'},'klassiek',2,root+'?code=privaat&email=persoon@example.test#access_token=geheim');
 assert.equal(url,root+'#recept/zalm?porties=2');
});
test('Oude receptlinks en aliases blijven leesbaar',()=>{
 assert.deepEqual(parseRecipeLink('#recept/bolognese'),{id:'bolognese',variant:null,servings:null});
 assert.deepEqual(parseRecipeLink('#recept/chocolade-lavacake-melkchocolade'),{id:'chocolade-lavacake-melkchocolade',variant:null,servings:null});
});
test('Ongeldige en lege receptlinks veroorzaken geen URIError',()=>{
 for(const hash of ['','#boodschappenlijst','#recept/','#recept/%E0%A4%A'])assert.equal(parseRecipeLink(hash),null);
});
test('Ongeldige porties vallen terug op het basisrecept',()=>{
 for(const value of ['',0,-2,'1.5','NaN','Infinity','1e3','9007199254740992','4abc']){
  assert.equal(parseRecipeLink('#recept/zalm?porties='+value).servings,null,String(value));
 }
 assert.equal(parseRecipeLink('#recept/zalm?porties=1').servings,1);
});
test('Recept-ID en variant worden als gegevens gecodeerd',()=>{
 const url=recipeShareUrl({id:'a & b'},'x&y',3,root);
 assert.deepEqual(parseRecipeLink(new URL(url).hash),{id:'a & b',variant:'x&y',servings:3});
});
