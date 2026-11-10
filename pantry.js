'use strict';
/* Persoonlijke standaardvoorraad. Zelfstandig, zodat de receptenlogica klein blijft. */
(function(root){
 const groups=[
  ['Kruiden en specerijen','Gedroogde basilicum|Chilipoeder|Dille|Gerookt paprikapoeder|Kurkuma|Kaneel|Kerrie|Knoflookpoeder|Komijnzaad|Korianderblad|Laurierblad|Marjoraan|Nootmuskaat|Oregano|Peterselie (gedroogd)|Uienpoeder|Rozemarijn|Tijm|Zout|Zwarte peper'.split('|')],
  ['Smaakmakers en sauzen','Honing|Sojasaus|Ketjap|Citroensap|Balsamicoazijn|Runderbouillon|Tomatenpuree'.split('|')],
  ['Droge voorraad en basisproducten','Rijst|Pasta|Bloem|Paneermeel|Zelfrijzend bakmeel|Maizena|Suiker|Olijfolie|Zonnebloemolie'.split('|')]
 ];
 const allowedGroups=new Set([...groups.map(g=>g[0]),'Zelf toegevoegd']);
 const reserved=new Set(['__proto__','constructor','prototype']);
 function create(storage,key,canonical,onChange){
  const canonicalId=name=>canonical(String(name||'').trim());
  function defaults(){
   return groups.flatMap(([group,names])=>names.map(name=>({id:canonicalId(name),name,group,have:true})));
  }
  function validate(data){
   if(!Array.isArray(data)||data.length>200)throw Error('Ongeldige standaardvoorraad.');
   const seen=new Set();
   return data.map(x=>{
    if(!x||typeof x!=='object'||Array.isArray(x)||typeof x.id!=='string'||
       x.id.length<2||x.id.length>100||reserved.has(x.id)||
       typeof x.name!=='string'||x.name.trim().length<2||x.name.length>100||
       !allowedGroups.has(x.group)||typeof x.have!=='boolean'||
       canonicalId(x.name)!==x.id||seen.has(x.id))throw Error('Ongeldig voorraadproduct.');
    seen.add(x.id);
    return {id:x.id,name:x.name,group:x.group,have:x.have};
   });
  }
  function load(){
   try{
    const old=storage.getItem(key);
    return old===null?defaults():validate(JSON.parse(old));
   }catch(e){return defaults();}
  }
  let items=load();
  function persist(){
   try{
    storage.setItem(key,JSON.stringify(items));
    if(typeof onChange==='function')onChange();
    return true;
   }catch(e){return false;}
  }
  function get(){return items.map(p=>({...p}));}
  function isHome(name){const id=canonicalId(name);return items.some(p=>p.id===id&&p.have);}
  function set(id,have){
   const p=items.find(p=>p.id===id);
   if(!p)return false;
   p.have=!!have;persist();return true;
  }
  function add(value){
   const name=String(value||'').trim().replace(/\s+/g,' ');
   const id=canonicalId(name);
   if(name.length<2||name.length>100||id.length>100||reserved.has(id))
    return {ok:false,message:'Vul een geldige productnaam van 2 tot 100 tekens in.'};
   const existing=items.find(x=>x.id===id);
   if(existing){set(id,true);return {ok:true,id,message:name+' is weer als in huis gemarkeerd.'};}
   if(items.length>=200)return {ok:false,message:'De voorraad kan maximaal 200 producten bevatten.'};
   items.push({id,name,group:'Zelf toegevoegd',have:true});persist();
   return {ok:true,id,message:name+' is toegevoegd aan je voorraad.'};
  }
  function remove(id){
   if(!items.some(x=>x.id===id&&x.group==='Zelf toegevoegd'))return false;
   items=items.filter(x=>x.id!==id);persist();return true;
  }
  function reset(){
   const ids=[...new Set([...items,...defaults()].map(p=>p.id))];
   items=defaults();persist();return ids;
  }
  function restore(data){items=validate(data);persist();}
  function html(escape,expanded=false){
   const enabled=items.filter(x=>x.have).length;
   const categories=[...groups.map(g=>g[0]),'Zelf toegevoegd'].map(group=>{
    const members=items.filter(x=>x.group===group);
    if(!members.length)return '';
    return '<fieldset class="pantry-group"><legend>'+escape(group)+'</legend><div class="pantry-grid">'+
     members.map(p=>'<div class="pantry-product"><label><input type="checkbox" data-pantry-id="'+escape(p.id)+'"'+(p.have?' checked':'')+'>'+
      '<span>'+escape(p.name)+'</span></label>'+
      (group==='Zelf toegevoegd'?'<button type="button" data-pantry-remove="'+escape(p.id)+'" aria-label="Verwijder '+escape(p.name)+'">Verwijder</button>':'')+
      '</div>').join('')+'</div></fieldset>';
   }).join('');
   return '<details id="pantryPanel" class="pantry-editor"'+(expanded?' open':'')+'>'+
    '<summary>Mijn standaardvoorraad <span>('+enabled+' in huis)</span></summary>'+
    '<div class="pantry-content"><p>Deze producten heb je volgens je keukenprofiel gewoonlijk in huis. Controleer de hoeveelheid voor het koken. Gedroogde kruiden zijn niet hetzelfde als verse kruiden.</p>'+
    categories+'<div class="pantry-add"><label for="pantryNew">Product toevoegen</label>'+
    '<div class="pantry-add-actions"><input id="pantryNew" type="text" maxlength="100" placeholder="Bijv. havermout" autocomplete="off">'+
    '<button type="button" class="btn alt" id="pantryAdd">Voeg toe</button></div>'+
    '<p>Gebruik bij voorkeur dezelfde naam als op de boodschappenlijst.</p></div>'+
    '<button type="button" class="btn alt" id="pantryReset">Herstel beginvoorraad uit keukenprofiel</button>'+
    '<p id="pantryStatus" class="pantry-message" role="status" aria-live="polite"></p></div></details>';
  }
  return {defaults,get,isHome,set,add,remove,reset,restore,validate,html};
 }
 const library={create};
 root.CookbookPantry=library;
 if(typeof module!=='undefined'&&module.exports)module.exports=library;
})(typeof window!=='undefined'?window:globalThis);
