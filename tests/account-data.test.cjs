'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../account-data.js'),P=require('../pantry.js');global.CookbookData=D;
const Compare=require('../conflict-review.js');
const store=()=>{const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
const storage=store(),pantry=P.create(storage,D.STORAGE.pantry,P.canonical);
const personal=()=>D.readPersonal(storage,pantry);
const diary=()=>({goals:{kcal:2000},days:{'2026-11-16':[{id:'lunch',title:'Lunch',nutrition:{kcal:400}}]}});
const validate=x=>{assert.ok(x?.days,'Ongeldig dagboek');return x;};
const joint=()=>({app:'mijn-kookboek-alle-gegevens',version:1,exportedAt:new Date().toISOString(),data:{diary:diary(),personal:personal()}});
test('Gezamenlijke back-up controleert beide onderdelen',()=>{const value=joint();assert.deepEqual(D.parseBackup(value,validate,pantry),value.data);});
test('Ontbrekende of ongeldige onderdelen keuren het gehele bestand af',()=>{
 for(const field of ['diary','personal']){const value=joint();delete value.data[field];assert.throws(()=>D.parseBackup(value,validate,pantry));}
 const value=joint();value.data.personal.notes={x:{rating:8}};assert.throws(()=>D.parseBackup(value,validate,pantry),/notities/);assert.equal(storage.data.size,0);
});
test('Oude losse bestanden herstellen alleen hun eigen onderdeel',()=>{
 assert.deepEqual(D.parseBackup({app:'mijn-kookboek-voedingsdagboek',version:1,data:diary()},validate,pantry),{diary:diary(),personal:undefined});
 const p=personal();assert.deepEqual(D.parseBackup({app:'mijn-kookboek',version:1,exportedAt:new Date().toISOString(),data:p},validate,pantry),{diary:undefined,personal:p});
 delete p.pantry;assert.deepEqual(D.parseBackup({app:'mijn-kookboek',version:1,exportedAt:new Date().toISOString(),data:p},validate,pantry,storage).personal.pantry,personal().pantry);
});
test('Voorraad gebruikt dezelfde aliassen op beide pagina’s',()=>{
 assert.equal(P.canonical('Extra vierge olijfolie'),'olijfolie');const value=personal();value.pantry.push({id:'paprika',name:'Rode paprika',group:'Zelf toegevoegd',have:true});assert.equal(D.personal(value,pantry).pantry.at(-1).id,'paprika');
});
test('Opslagfout herstelt alle eerdere writes inclusief hersteljournals',()=>{
 const s=store();s.setItem('diary','old diary');s.setItem('personal','old personal');let writes=0;const original=s.setItem;s.setItem=(k,v)=>{if(++writes===3)throw Error('Quota');original(k,v);};
 assert.throws(()=>D.writeAtomic(s,[{key:'diary',value:'new diary'},{key:'journal',value:'new journal'},{key:'personal',value:'new personal'}]),/Alle oorspronkelijke gegevens zijn teruggezet/);
 assert.equal(s.getItem('diary'),'old diary');assert.equal(s.getItem('personal'),'old personal');assert.equal(s.getItem('journal'),null);
});
test('Mislukte rollback krijgt een expliciete fout',()=>{
 const s=store();s.setItem('a','old');let writes=0;const original=s.setItem;s.setItem=(k,v)=>{if(++writes>=2)throw Error('Storage blocked');original(k,v);};
 assert.throws(()=>D.writeAtomic(s,[{key:'a',value:'new'},{key:'b',value:'new'}]),/volledig terugzetten zijn mislukt/);
});
test('Verschillen tonen toevoegingen, verwijderingen, notities en voedingswaarden',()=>{
 const a=personal(),b=personal();a.favorites=['lokale-favoriet'];b.favorites=['cloud-favoriet'];a.notes={gerecht:{notes:'Meer knoflook',rating:4}};b.notes={gerecht:{notes:'Minder zout',rating:5}};
 const rows=Compare.rows('personal',a,b);assert.equal(rows.length,3);assert.ok(rows.some(r=>r.local===undefined));assert.ok(rows.some(r=>r.cloud===undefined));assert.match(Compare.display(rows.find(r=>r.label.startsWith('Kooknotitie')).local),/Meer knoflook/);
 const x=diary(),y=diary();y.days['2026-11-16'][0].nutrition.kcal=600;const changed=Compare.rows('diary',x,y);assert.equal(changed.length,1);assert.match(changed[0].label,/Lunch/);assert.match(Compare.display(changed[0].cloud),/600/);
});
test('JSON-sleutelvolgorde levert geen schijnverschil op',()=>{assert.equal(D.stable({a:1,b:{x:2,y:3}}),D.stable({b:{y:3,x:2},a:1}));});
