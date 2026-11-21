'use strict';
(function(root){
 const labels={ingredientChecks:'Afgevinkte ingrediënten',basket:'Boodschappenrecept',basketChecks:'Boodschappen afgevinkt',notes:'Kooknotitie',cookProgress:'Kookvoortgang',weekdayPresets:'Vaste maaltijd',weekdayApplied:'Vaste maaltijden verwerkt',title:'Maaltijd',nutrition:'Voedingswaarde',kcal:'kcal',proteinG:'Eiwitten (g)',carbsG:'Koolhydraten (g)',fatG:'Vetten (g)',fiberG:'Vezels (g)',feedback:'Feedback',rating:'Beoordeling',lastCookedOn:'Laatst gekookt',servings:'Porties',includeOptional:'Optionele ingrediënten',step:'Stap',done:'Afgerond',have:'In huis',quantity:'Aantal',label:'Portie',portion:'Portiegegevens',enabled:'Actief',startDate:'Vanaf',id:'Kenmerk',source:'Bron',recipe:'Receptgegevens',version:'Receptversie',baseVersion:'Basisversie',variantId:'Variant',name:'Product',group:'Groep'};
 let titles={};
 const same=(a,b)=>root.CookbookData.stable(a)===root.CookbookData.stable(b);
 const name=key=>titles[key]||String(key).replace(/[-_]/g,' ');
 function rows(kind,local,cloud){
  const result=[];
  const add=(label,a,b)=>{if(!same(a,b))result.push({label,local:a,cloud:b});};
  const map=(label,a={},b={})=>{for(const key of new Set([...Object.keys(a||{}),...Object.keys(b||{})]))add(label+' · '+(labels[key]||name(key)),a?.[key],b?.[key]);};
  const keyed=(list,key)=>Object.fromEntries((list||[]).map(x=>[x[key],x]));
  if(kind==='diary'){
   map('Richtwaarden',local?.goals,cloud?.goals);
   for(const day of new Set([...Object.keys(local?.days||{}),...Object.keys(cloud?.days||{})])){
    const a=keyed(local?.days?.[day],'id'),b=keyed(cloud?.days?.[day],'id');
    for(const id of new Set([...Object.keys(a),...Object.keys(b)]))add(day+' · '+(a[id]?.title||b[id]?.title||'Maaltijd'),a[id],b[id]);
   }
   for(const field of ['weekdayPresets','weekdayApplied'])map(labels[field],local?.[field],cloud?.[field]);
   map('Opgeslagen maaltijd',keyed(local?.quickMeals,'id'),keyed(cloud?.quickMeals,'id'));
  }else{
   const f=list=>Object.fromEntries((list||[]).map(x=>[x,'Bewaard']));
   map('Favoriet',f(local?.favorites),f(cloud?.favorites));
   for(const field of ['ingredientChecks','basket','basketChecks','notes','cookProgress'])map(labels[field],local?.[field],cloud?.[field]);
   map('Voorraad',keyed(local?.pantry,'id'),keyed(cloud?.pantry,'id'));
  }
  return result;
 }
 function display(value){
  if(value===undefined||value===null)return 'Niet aanwezig';
  if(typeof value==='boolean')return value?'Ja':'Nee';
  if(Array.isArray(value))return value.length?value.map(display).join(', '):'Geen';
  if(typeof value==='object')return Object.entries(value).map(([key,item])=>(key==='notes'?'Notitie':labels[key]||key)+': '+display(item)).join('\n')||'Geen';
  return String(value);
 }
 const pending=new Map();
 function cancel(id){pending.get(id)?.(null);}
 function show(id,kind,local,cloud){
  cancel(id);const node=document.getElementById(id);if(!node)return Promise.resolve(null);
  const previous=document.activeElement;node.replaceChildren();node.hidden=false;
  const element=(tag,text,parent=node)=>{const x=document.createElement(tag);if(text)x.textContent=text;parent.appendChild(x);return x;};
  const heading=element('h3','Vergelijk dit apparaat met je account');heading.tabIndex=-1;
  const diff=rows(kind,local,cloud);
  element('p',diff.length?diff.length+' verschil(len). Kies hieronder welke volledige versie je wilt behouden. Er wordt niets automatisch samengevoegd.':'Er zijn geen inhoudelijke verschillen. Je kunt deze gegevens veilig aan je account koppelen.');
  element('p','“Dit apparaat behouden” vervangt de accountversie. “Accountgegevens gebruiken” vervangt de versie op dit apparaat. Maak eerst een back-up als je beide wilt bewaren.');
  if(!cloud)element('p','Voor dit onderdeel staan nog geen gegevens in je account.');
  const holder=element('div');holder.className='comparison-scroll';
  const table=element('table',null,holder);table.className='comparison-table';
  element('caption',kind==='diary'?'Verschillen in je voedingsdagboek':'Verschillen in je kookboekgegevens',table).className='sr-only';
  const head=element('tr',null,element('thead',null,table));
  for(const label of ['Onderdeel','Dit apparaat','Je account'])element('th',label,head).scope='col';
  const body=element('tbody',null,table);let count=0;
  const more=element('button','Meer verschillen tonen');more.type='button';more.className='secondary btn alt';
  function next(){
   for(const row of diff.slice(count,count+25)){
    const tr=element('tr',null,body);element('th',row.label,tr).scope='row';
    for(const value of [row.local,row.cloud])element('pre',display(value),element('td',null,tr));
   }
   count+=25;more.hidden=count>=diff.length;table.hidden=diff.length===0;
  }
  more.onclick=next;next();
  const actions=element('div');actions.className='actions backup-actions';
  return new Promise(resolve=>{
   const finish=choice=>{pending.delete(id);node.hidden=true;node.replaceChildren();if(previous?.isConnected)previous.focus({preventScroll:true});resolve(choice);};
   pending.set(id,finish);
   for(const [value,label] of [['local','Dit apparaat behouden'],['cloud','Accountgegevens gebruiken'],[null,'Annuleren']]){
    const button=element('button',label,actions);button.type='button';button.className='secondary btn alt';
    button.disabled=value==='cloud'&&!cloud;button.onclick=()=>finish(value);button.dataset.choice=value||'cancel';
   }
   heading.focus({preventScroll:true});node.scrollIntoView?.({block:'nearest',behavior:'smooth'});
  });
 }
 const api={rows,display,show,cancel,setTitles(value){titles=value;}};
 root.CookbookCompare=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
