/* Accountscherm: beide onderdelen, één back-up en gecontroleerd herstel. */
(function(root){
 'use strict';
 const D=root.CookbookData,KEY='mijn-kookboek-voedingsdagboek';
 const el=id=>document.getElementById(id);
 function init(hooks){
  const pantry=root.CookbookPantry.create(localStorage,D.STORAGE.pantry,root.CookbookPantry.canonical);
  const personal=()=>D.readPersonal(localStorage,pantry);
  let preview=null,encrypted=null,sequence=0,diaryStatus={};
  const owner=()=>hooks.cloudMode?root.CookbookCloud.snapshot().userId:'local';
  const message=(text,error=false)=>{el('allBackupStatus').textContent=text;el('allBackupStatus').classList.toggle('error',error);};
  function badge(id,snapshot){
   const node=el(id);if(!node)return;
   let text='Opgeslagen',tone='synced';
   if(!hooks.cloudMode){text='Opgeslagen op dit apparaat';tone='neutral';}
   else if(snapshot.conflict||snapshot.loggedIn&&!snapshot.ready&&!snapshot.busy){text='Actie nodig';tone='attention';}
   else if(snapshot.pending){text=snapshot.error||root.navigator.onLine===false?'Wacht op verbinding':'Synchroniseren…';tone='pending';}
   else if(snapshot.error){text='Actie nodig';tone='attention';}
   else if(!snapshot.loggedIn){text='Log in';tone='neutral';}
   else if(!snapshot.ready){text='Gegevens laden…';tone='pending';}
   node.textContent=text;node.dataset.state=tone;
  }
  function ready(kind){
   if(!hooks.cloudMode)return true;
   const a=root.CookbookCloud.snapshot(),b=root.CookbookPersonalCloud.snapshot();
   if(kind==='diary')return a.ready&&Boolean(a.userId);
   return b.ready&&Boolean(a.userId)&&a.userId===b.userId&&b.boundUserId===a.userId;
  }
  function update(){
   const complete=ready('diary')&&ready('personal');
   el('diaryCompare').hidden=!hooks.cloudMode;el('diaryCompare').disabled=!ready('diary');
   el('allBackupDownload').disabled=!complete;el('allBackupEncrypted').disabled=!complete;
   el('allBackupHint').textContent=complete?'Bevat je dagboek, doelen, vaste maaltijden, favorieten, boodschappen, voorraad, notities en kookvoortgang. Recepten zelf blijven in de gedeelde collectie.':
    'Log in en koppel hieronder je kookboekgegevens om beide onderdelen in één bestand te bewaren. Beide onderdelen moeten beschikbaar zijn voor een volledige back-up.';
   if(preview&&preview.owner!==owner())clear();
  }
  function capture(){return D.stable({owner:owner(),diary:hooks.getDiary(),personal:personal(),localDiary:localStorage.getItem(KEY)});}
  function payload(){
   if(!ready('diary')||!ready('personal'))throw Error('Log in en koppel eerst beide gegevensonderdelen.');
   const diary=hooks.validateDiary(hooks.getDiary());
   const result={app:'mijn-kookboek-alle-gegevens',version:1,exportedAt:new Date().toISOString(),data:{diary,personal:personal()}};
   D.parseBackup(result,hooks.validateDiary,pantry);return result;
  }
  function download(data,name){
   const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),url=URL.createObjectURL(blob);
   const a=document.createElement('a');a.href=url;a.download=name;
   document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function clear(){
   sequence++;preview=null;encrypted=null;
   el('allBackupPreview').hidden=true;el('allBackupDecryptBox').hidden=true;
   el('allBackupFile').value='';el('allBackupDecryptPass').value='';
  }
  function check(data){
   if(data.diary&&!ready('diary'))throw Error('Open eerst het dagboek van het juiste account.');
   if(data.personal&&!ready('personal'))throw Error('Koppel eerst de kookboekgegevens aan het juiste account.');
  }
  function showPreview(value,expectedOwner){
   if(owner()!==expectedOwner)throw Error('Het account is intussen gewijzigd. Selecteer het bestand opnieuw.');
   const data=D.parseBackup(value,hooks.validateDiary,pantry);check(data);
   preview={data,owner:owner(),original:capture()};
   const parts=[];
   if(data.diary)parts.push(Object.values(data.diary.days).reduce((n,entries)=>n+entries.length,0)+' maaltijdregistraties, voedingsdoelen en vaste maaltijden');
   if(data.personal)parts.push(data.personal.favorites.length+' favorieten, '+Object.keys(data.personal.basket).length+' boodschappenrecepten, '+Object.keys(data.personal.notes).length+' kooknotities en '+data.personal.pantry.length+' voorraadproducten');
   el('allBackupSummary').textContent=parts.join(' · ')+'.';
   el('allBackupScope').textContent=data.diary&&data.personal?'Dit vervangt je volledige dagboek en je persoonlijke kookboekgegevens.':data.diary?'Dit oude bestand vervangt alleen je dagboek. Je kookboekgegevens blijven behouden.':'Dit oude bestand vervangt alleen je kookboekgegevens. Je dagboek blijft behouden.';
   el('allBackupPreview').hidden=false;message('Bestand volledig gecontroleerd. Er is nog niets gewijzigd.');
  }
  el('allBackupDownload').onclick=()=>{
   try{download(payload(),'mijn-kookboek-alle-gegevens-'+new Date().toLocaleDateString('sv-SE')+'.json');message('Gezamenlijke back-up aangemaakt. Dit JSON-bestand is niet versleuteld; bewaar het afgeschermd.');}
   catch(error){message(error.message,true);}
  };
  el('allBackupEncrypted').onclick=async()=>{
   const button=el('allBackupEncrypted'),pass=el('allBackupPass').value,confirmation=el('allBackupPassConfirm').value;
   if(pass.length<12||pass!==confirmation){message('Gebruik tweemaal dezelfde wachtzin van minimaal 12 tekens.',true);return;}
   button.disabled=true;
   try{
    const account=owner(),result=await root.CookbookBackup.encrypt(payload(),pass);
    if(account!==owner())throw Error('Het account is intussen gewijzigd. Maak de back-up opnieuw.');
    download(result,'mijn-kookboek-alle-gegevens-versleuteld-'+new Date().toLocaleDateString('sv-SE')+'.json');
    message('Gezamenlijke versleutelde back-up aangemaakt. Bewaar de wachtzin apart; die wordt niet opgeslagen.');
   }catch(error){message('Back-up maken mislukt: '+error.message,true);}
   finally{el('allBackupPass').value='';el('allBackupPassConfirm').value='';update();}
  };
  el('allBackupFile').onchange=async event=>{
   const file=event.target.files[0];clear();if(!file)return;
   const token=sequence,account=owner();
   if(file.size>6*1024*1024){message('Bestand te groot (maximaal 6 MB).',true);return;}
   try{
    const value=JSON.parse(await file.text());if(token!==sequence)return;
    if(root.CookbookBackup.isEncrypted(value)){
     encrypted={value,owner:account};el('allBackupDecryptBox').hidden=false;el('allBackupDecryptPass').focus();
     message('Vul de wachtzin in om het bestand te controleren.');
    }else showPreview(value,account);
   }catch(error){message('Bestand niet hersteld: '+error.message,true);}
  };
  el('allBackupDecrypt').onclick=async()=>{
   if(!encrypted)return;const record=encrypted,token=sequence,button=el('allBackupDecrypt');button.disabled=true;
   try{
    const value=await root.CookbookBackup.decrypt(record.value,el('allBackupDecryptPass').value);
    if(token!==sequence)return;showPreview(value,record.owner);el('allBackupDecryptBox').hidden=true;encrypted=null;
   }catch(error){message('Ontsleutelen mislukt: '+error.message,true);}
   finally{el('allBackupDecryptPass').value='';button.disabled=false;}
  };
  el('allBackupCancel').onclick=()=>{clear();message('Herstellen geannuleerd.');};
  el('allBackupDecryptCancel').onclick=()=>{clear();message('Herstellen geannuleerd.');};
  el('allBackupRestore').onclick=()=>{
   if(!preview)return;
   try{
    if(preview.owner!==owner()||preview.original!==capture())throw Error('Je gegevens of account zijn intussen gewijzigd. Selecteer het bestand opnieuw.');
    const {data}=preview;check(data);
    if(!hooks.canRestore())throw Error('Sluit eerst de open maaltijdinvoer of bewerking.');
    if(!root.confirm('De gecontroleerde onderdelen vervangen je huidige gegevens. Bij een gekoppeld account worden ze daarna gesynchroniseerd. Doorgaan?'))return;
    if(preview.owner!==owner()||preview.original!==capture())throw Error('De gegevens zijn intussen gewijzigd. Selecteer het bestand opnieuw.');
    // No await between concurrency checks, staging, atomic write and activation.
    const stages=[],writes=[];
    if(data.diary){
     if(hooks.cloudMode)stages.push(root.CookbookCloud.prepareRestore(data.diary));
     else writes.push({key:KEY,value:JSON.stringify(data.diary)});
    }
    if(data.personal){
     writes.push(...D.personalWrites(data.personal));
     if(hooks.cloudMode)stages.push(root.CookbookPersonalCloud.prepareRestore(data.personal));
    }
    for(const stage of stages)writes.push(...stage.writes);
    D.writeAtomic(localStorage,writes);
    for(const stage of stages)stage.commit();
    if(data.diary)hooks.setDiary(data.diary);
    clear();message(hooks.cloudMode?'Hersteld op dit apparaat. Beide onderdelen synchroniseren afzonderlijk; controleer hun status hierboven.':'Gegevens hersteld op dit apparaat.');update();
   }catch(error){message('Herstellen niet voltooid: '+error.message,true);}
  };
  root.CookbookPersonalCloud.start({
   getLocal:personal,validate:data=>D.personal(data,pantry),
   apply(data){D.writeAtomic(localStorage,D.personalWrites(D.personal(data,pantry)));},
   canApply:()=>!preview,
   download(){try{download({app:'mijn-kookboek',version:1,exportedAt:new Date().toISOString(),data:personal()},'mijn-kookboek-persoonlijk.json');}catch(error){message(error.message,true);}},
   review:(local,cloud)=>root.CookbookCompare.show('personalConflictReview','personal',local,cloud),
   cancelReview(){root.CookbookCompare.cancel('personalConflictReview');},
   onStatus(snapshot){badge('personalDataState',snapshot);update();}
  });
  el('diaryCompare').onclick=()=>root.CookbookCloud.review();
  if(!hooks.cloudMode){el('cloudPanel').hidden=false;el('cloudLogin').hidden=true;el('cloudUser').hidden=true;el('cloudStatus').textContent='Je voedingsdagboek staat in deze browser.';}
  badge('diaryDataState',hooks.cloudMode?diaryStatus:{ready:true});update();
  return {
   status(snapshot){diaryStatus=snapshot;badge('diaryDataState',snapshot);update();},
   logout(){clear();root.CookbookCompare.cancel('diaryConflictReview');root.CookbookCompare.cancel('personalConflictReview');},
   review:(local,cloud)=>root.CookbookCompare.show('diaryConflictReview','diary',local,cloud)
  };
 }
 root.CookbookAccount={init};
})(window);
