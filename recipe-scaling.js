(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.CookbookScaling=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const fractions={'⅛':.125,'¼':.25,'⅓':1/3,'⅜':.375,'½':.5,'⅝':.625,'⅔':2/3,'¾':.75,'⅞':.875};
 const words={een:1,'één':1,twee:2,drie:3,vier:4,vijf:5,zes:6};
 const number='(?:\\d{1,4}(?:[.,]\\d{1,3})?[⅛¼⅓⅜½⅝⅔¾⅞]?|[⅛¼⅓⅜½⅝⅔¾⅞]|één|een|twee|drie|vier|vijf|zes)';
 const leading=new RegExp('^('+number+')(?:([–-])('+number+'))?(?=\\s|$)','iu');
 const forms=[['stuk','stuks'],['teentje','teentjes'],['teen','tenen'],['plakje','plakjes'],['plak','plakken'],['blaadje','blaadjes'],['slablaadje','slablaadjes'],['laurierblaadje','laurierblaadjes'],['plantje','plantjes'],['basilicumplantje','basilicumplantjes'],['snee','sneetjes'],['portie','porties'],['stokbrood','stokbroden'],['brood','broden'],['pitabroodje','pitabroodjes'],['flatbread','flatbreads'],['wrap','wraps'],['broodje','broodjes'],['bol','bollen'],['mok','mokken'],['schnitzel','schnitzels'],['kipschnitzel','kipschnitzels'],['burger','burgers'],['bord','borden'],['filet','filets'],['wijnglas','wijnglazen'],['glas','glazen'],['ramequin','ramequins'],['vormpje','vormpjes'],['kofta',"kofta's"],['paprika',"paprika's"],['courgette','courgettes'],['komkommer','komkommers'],['wortel','wortels'],['tomaat','tomaten'],['ui','uien'],['peper','pepers'],['sjalot','sjalotten'],['ei','eieren'],['bolletje','bolletjes'],['snufje','snufjes']];
 forms.push(['afbakstokbrood','afbakstokbroden'],['stukje','stukjes'],['schijfje','schijfjes'],['stuk','stukken']);
 const units='(?:kg|g|ml|l|tl|el|eetlepels?|'+forms.flat().sort((a,b)=>b.length-a.length).join('|')+')';
 const adjectives='(?:(?:rode|witte|verse|rijpe|grote|kleine|klein|dunne|grote,|gelijke|warme|bereide|krokante|ingevette|ovenbestendige|zachte|heel|losgeklopt|losgeklopte|geperst|geperste|fijngehakte|fijngehakt|fijngeraspt)\\s+){0,3}';
 // This is a validation guard, never a rule for deciding how a quantity scales.
 const measuredNumber=number.replace('|een|','|');
 const measured=new RegExp('(?<![\\p{L}\\p{N}.,–-])'+measuredNumber+'(?:[–-]'+measuredNumber+')?\\s+'+adjectives+units+'\\b','giu');
 function parseNumber(raw){
  if(Object.hasOwn(words,raw.toLowerCase()))return words[raw.toLowerCase()];
  const fraction=fractions[raw.at(-1)]||0;
  let n=fraction?raw.slice(0,-1):raw;
  if(/^\d{1,3}\.\d{3}$/.test(n))n=n.replace('.','');
  return (n?Number(n.replace(',','.')):0)+fraction;
 }
 function formatQty(n,unit){
  if(!['g','kg','ml','l'].includes(unit)){
   const whole=Math.floor(n),part=n-whole;
   if(Math.abs(n-Math.round(n))<.012)return String(Math.round(n));
   const hit=Object.entries(fractions).find(([,value])=>Math.abs(part-value)<.012);
   if(hit)return (whole||'')+hit[0];
  }
  return String(Math.round(n*100)/100).replace('.',',');
 }
 function ingredientQty(item,mult){
  if(item.scaleFixed)return item.qty;
  const value=item.qty*mult,round=item.scaleRoundTo||0;
  return round?Math.ceil((value-1e-9)/round)*round:value;
 }
 function locate(body,ref){
  let start=-1;
  for(let i=0;i<=(ref.occurrence||0);i++){
   start=body.indexOf(ref.text,start+1);
   if(start<0)return null;
  }
  return {start,end:start+ref.text.length};
 }
 function referenceQty(view,ref,mult){
  if(Object.hasOwn(ref,'ingredientIndex'))return ingredientQty([...view.ingredients,...(view.herbs||[])][ref.ingredientIndex],mult)*(ref.factor??1);
  return ref.perServing*view.servings*mult;
 }
 const eggText='Neem 2 eieren: gebruik 1 heel ei en alleen de dooier van het tweede ei.';
 function eggDirections(mult,format){
  const available=Math.ceil(mult),needed=2*available;
  if(Number.isInteger(mult))return 'Neem '+needed+' eieren: gebruik '+mult+' '+(mult===1?'heel ei':'hele eieren')+
   ' en alleen de '+(mult===1?'dooier':'dooiers')+' van '+mult+' '+(mult===1?'ander ei':'andere eieren')+'.';
  return 'Neem '+needed+' eieren. Klop '+available+' hele eieren los en weeg hiervan circa '+
   format(50*mult,'g')+' g af. Scheid '+available+' andere eieren en weeg hiervan circa '+
   format(18*mult,'g')+' g eidooier af. Meng de afgewogen hoeveelheden.';
 }
 function inflect(tail,qty){
  // Only the first unit/noun following the quantity; ingredient names later in
  // the anchor must never be pluralised (e.g. "1 tl zwarte peper").
  return tail.replace(/^(\s+(?:(?:rode|witte|verse|rijpe|grote|kleine|klein|dunne|grote,|gelijke|warme|bereide|krokante|ingevette|ovenbestendige|zachte|losgeklopt|losgeklopte|geperst|geperste|fijngehakte|fijngehakt|fijngeraspt)\s+){0,3})([\p{L}'’]+)/u,(_,prefix,noun)=>{
   const pair=forms.find(pair=>pair.includes(noun.toLowerCase().replace('’',"'")));
   if(!pair)return prefix+noun;
   const single=qty<=1+.000001;
   for(const adjective of ['losgeklopt','geperst','fijngeraspt','fijngehakt','klein'])
    prefix=prefix.replace(new RegExp(adjective+'(?:e)? '),adjective+(single?'':'e')+' ');
   if(single&&['wijnglas','glas'].includes(pair[0]))prefix=prefix.replace('grote ','groot ');
   return prefix+pair[single?0:1];
  });
 }
 function renderStep(view,step,mult,format=formatQty){
  const body=step.body||'';
  if(mult===1)return body;
  if(!Number.isFinite(mult)||mult<=0)throw Error('Ongeldige portiefactor');
  const edits=[];
  for(const ref of step.quantityRefs||[]){
   if(ref.fixed)continue;
   const position=locate(body,ref),match=ref.text.match(leading);
   if(ref.eggMixture!==undefined){
    if(!position)throw Error('Eimengsel niet gevonden in de bereidingsstap');
    edits.push({...position,text:eggDirections(mult,format)});continue;
   }
   if(!position||!match)throw Error('Hoeveelheidsverwijzing past niet bij de bereidingsstap');
   const qty=referenceQty(view,ref,mult);
   const tail=ref.text.slice(match[0].length),unit=tail.trim().split(/\s/)[0];
   const range=match[3]?match[2]+format(qty*parseNumber(match[3])/parseNumber(match[1]),unit):'';
   edits.push({...position,text:format(qty,unit)+range+inflect(tail,qty)});
  }
  // Positions refer to the original body, so replacements cannot affect one
  // another or replace a number that was just generated by another reference.
  return edits.sort((a,b)=>b.start-a.start).reduce((text,edit)=>text.slice(0,edit.start)+edit.text+text.slice(edit.end),body);
 }
 function validateStep(view,step){
  const errors=[],body=typeof step.body==='string'?step.body:'',spans=[];
  if(!Array.isArray(step.quantityRefs))return ['quantityRefs ontbreekt; leg hoeveelheden expliciet vast'];
  for(const [i,ref] of step.quantityRefs.entries()){
   const fail=message=>errors.push('quantityRefs['+i+']: '+message);
   if(!ref||typeof ref!=='object'||typeof ref.text!=='string'||!ref.text){fail('tekstanker ontbreekt');continue;}
   if(ref.occurrence!==undefined&&(!Number.isInteger(ref.occurrence)||ref.occurrence<0)){fail('ongeldige occurrence');continue;}
   const position=locate(body,ref);
   if(!position){fail('tekstanker niet gevonden');continue;}
   if(ref.occurrence===undefined&&body.indexOf(ref.text,position.start+1)>=0)fail('dubbel tekstanker; specificeer occurrence');
   if(spans.some(p=>p.start<position.end&&position.start<p.end))fail('overlappende tekstankers');
   spans.push(position);
   const sources=['ingredientIndex','perServing','fixed','eggMixture'].filter(k=>Object.hasOwn(ref,k));
   if(sources.length!==1){fail('kies precies één bron: ingredientIndex, perServing, fixed of eggMixture');continue;}
   if(ref.eggMixture!==undefined){
    const item=view.ingredients?.[ref.eggMixture];
    if(!Number.isInteger(ref.eggMixture)||!step.ingredientIndices?.includes(ref.eggMixture)||
       !item||item.qty!==2||item.scaleRoundTo!==2||ref.text!==eggText||ref.factor!==undefined)
     fail('eimengsel vereist de standaardtekst en twee eieren met afrondstap 2');
    continue;
   }
   if(ref.fixed!==undefined){
    if(ref.fixed!==true)fail('fixed moet true zijn');
    if(ref.factor!==undefined)fail('vaste hoeveelheid mag geen factor hebben');
    continue;
   }
   const match=ref.text.match(leading);
   if(!match){fail('tekstanker moet beginnen met een hoeveelheid');continue;}
   if(ref.ingredientIndex!==undefined){
    const items=[...(view.ingredients||[]),...(view.herbs||[])],item=items[ref.ingredientIndex];
    if(!Number.isInteger(ref.ingredientIndex)||ref.ingredientIndex<0||!item||typeof item.qty!=='number'||item.qty<=0){fail('ongeldige ingrediëntbron');continue;}
    if(!step.ingredientIndices?.includes(ref.ingredientIndex))fail('ingrediëntbron niet aan stap gekoppeld');
   }else if(typeof ref.perServing!=='number'||!Number.isFinite(ref.perServing)||ref.perServing<=0){fail('perServing moet positief zijn');continue;}
   if(ref.factor!==undefined&&(ref.ingredientIndex===undefined||typeof ref.factor!=='number'||!Number.isFinite(ref.factor)||ref.factor<=0)){fail('ongeldige factor');continue;}
   const expected=referenceQty(view,ref,1),written=parseNumber(match[1]);
   if(Math.abs(expected-written)>.012)fail('basishoeveelheid komt niet overeen met bron');
  }
  for(const match of body.matchAll(measured)){
   if(!spans.some(p=>p.start<=match.index&&p.end>=match.index+match[0].length))errors.push('hoeveelheid zonder expliciete koppeling: '+match[0]);
  }
  return errors;
 }
 return {renderStep,validateStep,ingredientQty,formatQty};
});
