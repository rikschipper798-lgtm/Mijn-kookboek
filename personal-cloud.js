/* Privégegevens van Mijn Kookboek: opt-in accountkoppeling zonder stil verlies van lokale data.
   De bestaande browseropslag blijft leidend totdat de gebruiker de eerste overname kiest. */
(function(root){
 'use strict';
 const cfg=root.COOKBOOK_CLOUD_CONFIG||{};
 const enabled=cfg.active===true&&/^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(cfg.url||'')&&
  typeof cfg.publishableKey==='string'&&cfg.publishableKey.length>20;
 const el=id=>document.getElementById(id);
 const KEY='mijn-kookboek-persoonlijk-account-v1';
 const JOURNAL='mijn-kookboek-persoonlijk-herstel-v1:';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const validRevision=n=>Number.isSafeInteger(n)&&n>=0;
 let hooks=null,client=null,user=null,revision=0,pending=null,active=false,conflict=false;
 let sending=false,refreshing=false,loading=false,dirtyBeforeReady=false,applying=false;
 let timer=null,epoch=0,edits=0,cloudRow=null;
 const bound=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch(error){return null;}};
 const journalKey=id=>JOURNAL+id;
 const compare=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const readJournal=id=>{
  const raw=localStorage.getItem(journalKey(id));
  if(raw===null)return null;
  const value=JSON.parse(raw);
  if(!value||value.version!==1||value.userId!==id||!validRevision(value.baseRevision)||
    !value.nonce||typeof value.nonce!=='string'||!value.data)throw Error('Lokale herstelkopie is ongeldig; er wordt niets overschreven.');
  return {...value,data:hooks.validate(value.data)};
 };
 const nonce=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 function message(text,bad=false){
  const node=el('personalCloudStatus');
  if(node){node.textContent=text;node.classList.toggle('is-error',bad);}
  const badge=el('personalCloudShort');
  if(badge){
   badge.textContent=!user?'Persoonlijke gegevens: alleen dit apparaat':
    conflict?'Persoonlijke gegevens: conflict':
    pending?'Persoonlijke gegevens: upload in behandeling':
    active?'Persoonlijke gegevens: account gekoppeld':'Persoonlijke gegevens: koppeling kiezen';
  }
  const choices=el('personalCloudChoices');
  if(choices)choices.hidden=!user||active&&!conflict&&!pending;
  const info=el('personalCloudAccount');
  if(info)info.textContent=user?'Ingelogd als '+String(user.email||'account'):'Nog niet ingelogd';
  const signin=el('personalCloudSignIn');
  if(signin)signin.hidden=Boolean(user);
  const sync=el('personalCloudSync');
  if(sync)sync.disabled=!user||!active||sending||loading;
  const load=el('personalCloudLoad');
  if(load)load.hidden=!user||!(cloudRow&&cloudRow.data);
  const upload=el('personalCloudUpload');
  if(upload)upload.hidden=!user;
 }
 function schedule(ms=750){
  if(timer!==null)clearTimeout(timer);
  timer=setTimeout(()=>{timer=null;void flush();},ms);
 }
 function clearJournal(value){
  const old=readJournal(value.userId);
  if(!old||old.nonce!==value.nonce)throw Error('Een ander tabblad heeft een recentere herstelkopie opgeslagen.');
  localStorage.removeItem(journalKey(value.userId));
 }
 function bindAccount(id,rev){
  localStorage.setItem(KEY,JSON.stringify({userId:id,revision:rev,version:1}));
 }
 function rememberDraft(){
  const data=hooks.validate(hooks.getLocal());
  const previous=readJournal(user.id);
  if(previous&&(!pending||previous.nonce!==pending.nonce)){
   conflict=true;message('Een ander tabblad heeft je herstelkopie veranderd. Bewaar eerst een back-up en laad de pagina opnieuw.',true);
   return false;
  }
  const record={version:1,userId:user.id,baseRevision:pending?pending.baseRevision:revision,
   nonce:nonce(),data,savedAt:new Date().toISOString()};
  try{localStorage.setItem(journalKey(user.id),JSON.stringify(record));}
  catch(error){
   message('Lokale wijziging bestaat, maar een veilige cloud-herstelkopie kon niet worden opgeslagen. Maak eerst een JSON-back-up.',true);
   return false;
  }
  pending=record;edits++;
  message('Wijziging lokaal bewaard; synchronisatie volgt.');
  schedule();
  return true;
 }
 function changed(){
  if(applying)return;
  if(!hooks||!active||!user){dirtyBeforeReady=true;return;}
  rememberDraft();
 }
 async function fetchRow(id){
  const r=await client.from('cookbook_personal_data').select('data,revision').eq('user_id',id).maybeSingle();
  if(r.error)throw r.error;
  if(r.data&&(!validRevision(r.data.revision)||r.data.revision<1))
   throw Error('Onbekende cloudversie. Er wordt niets overgenomen.');
  return r.data;
 }
 function safeApply(remote){
  if(!remote)return;
  if(!hooks.canApply())throw Error('Sluit eerst een open kookmodus of bewerking voordat je de accountgegevens laadt.');
  const data=hooks.validate(remote.data);
  applying=true;
  try{hooks.apply(data);}
  finally{applying=false;}
 }
 function conflictNotice(text){
  conflict=true;message(text+' De lokale versie blijft behouden. Download je back-up en kies daarna bewust welke versie je wilt gebruiken.',true);
 }
 async function flush(){
  if(!active||!user||!pending||conflict||sending||loading)return;
  sending=true;const id=user.id,token=epoch;
  try{
   while(active&&pending&&!conflict&&epoch===token&&user?.id===id){
    const sent=pending;
    let response;
    if(sent.baseRevision===0){
     response=await client.from('cookbook_personal_data')
      .insert({user_id:id,data:sent.data,revision:1}).select('revision').single();
    }else{
     response=await client.from('cookbook_personal_data')
      .update({data:sent.data,revision:sent.baseRevision+1,updated_at:new Date().toISOString()})
      .eq('user_id',id).eq('revision',sent.baseRevision).select('revision').maybeSingle();
    }
    if(epoch!==token||user?.id!==id)return;
    if(response.error||!response.data){
     let latest;
     try{latest=await fetchRow(id);}
     catch(error){message('Cloudantwoord onzeker. Je gegevens blijven lokaal opgeslagen. Probeer later opnieuw.',true);return;}
     if(epoch!==token||user?.id!==id)return;
     if(latest&&compare(hooks.validate(latest.data),sent.data)){
      response={data:{revision:latest.revision}};
     }else if((latest?.revision||0)!==sent.baseRevision){
      cloudRow=latest;
      conflictNotice('Een ander apparaat heeft een recentere versie opgeslagen.');
      return;
     }else{
      message('Upload mislukt. De lokale herstelkopie blijft beschikbaar; probeer opnieuw bij verbinding.',true);
      return;
     }
    }
    revision=response.data.revision;
    bindAccount(id,revision);
    const stored=readJournal(id);
    if(!stored||stored.nonce!==pending?.nonce){
     conflictNotice('Een ander tabblad heeft ondertussen gegevens gewijzigd.');
     return;
    }
    if(pending.nonce===sent.nonce){
     clearJournal(sent);pending=null;
    }else{
     const next={...pending,baseRevision:revision};
     localStorage.setItem(journalKey(id),JSON.stringify(next));
     pending=next;
    }
    cloudRow={data:clone(sent.data),revision};
   }
   if(epoch===token&&!pending&&!conflict)message('Gesynchroniseerd met je persoonlijke account.');
  }catch(error){
   if(epoch===token)message('Synchronisatie is tijdelijk mislukt. Je wijzigingen en herstelkopie blijven op dit apparaat.',true);
  }finally{
   if(epoch===token){sending=false;if(pending&&!conflict)message('Wijzigingen wachten op synchronisatie.');}
  }
 }
 async function refresh(){
  if(!active||!user||pending||sending||conflict||loading||refreshing||dirtyBeforeReady||!hooks.canApply())return;
  const id=user.id,token=epoch,mark=edits;
  refreshing=true;
  try{
   const row=await fetchRow(id);
   if(token!==epoch||!active||user?.id!==id||pending||edits!==mark)return;
   if(!row&&revision>0)throw Error('Cloudgegevens ontbreken; lokale gegevens blijven behouden.');
   if(row&&row.revision!==revision){
    safeApply(row);
    revision=row.revision;bindAccount(id,revision);cloudRow=row;
    message('Nieuwste persoonlijke gegevens van je account geladen.');
   }
  }catch(error){if(token===epoch)message('Accountgegevens ophalen mislukt; lokale gegevens zijn niet overschreven: '+error.message,true);}
  finally{if(token===epoch)refreshing=false;}
 }
 function reset(){
  epoch++;user=null;revision=0;pending=null;active=false;conflict=false;
  sending=false;refreshing=false;loading=false;cloudRow=null;
  if(timer!==null){clearTimeout(timer);timer=null;}
  message('Log in via het voedingsdagboek om je persoonlijke kookboekgegevens op andere apparaten te gebruiken.');
 }
 async function loadSession(session){
  const next=session?.user;
  if(!next){reset();return;}
  if(user?.id===next.id&&(loading||active))return;
  epoch++;const token=epoch;
  user=next;active=false;conflict=false;pending=null;loading=true;
  message('Accountgegevens en lokale herstelkopie controleren…');
  try{
   const row=await fetchRow(next.id);
   if(token!==epoch)return;
   cloudRow=row;
   const stored=bound(),own=stored?.userId===next.id&&validRevision(stored.revision);
   if(!own){
    message(row?'Kies eenmalig: accountgegevens laden of de gegevens van dit apparaat gebruiken. Maak eerst een lokale back-up.':
     'Je account bevat nog geen persoonlijke kookboekgegevens. Je kunt de lokale gegevens veilig overnemen.');
    return;
   }
   revision=stored.revision;
   const draft=readJournal(next.id);
   if(draft){
    pending=draft;active=true;
    if(row&&compare(hooks.validate(row.data),draft.data)){
     revision=row.revision;
     clearJournal(draft);pending=null;bindAccount(next.id,revision);
     if(!dirtyBeforeReady&&hooks.canApply())safeApply(row);
     else{active=false;message('Er is ook een recente lokale wijziging. Kies bewust welke gegevens je wilt bewaren.');return;}
     message('Vorige upload was al veilig opgeslagen in je account.');
    }else if((row?.revision||0)!==draft.baseRevision){
     conflictNotice('Tijdens het offline werken is het account op een ander apparaat gewijzigd.');
    }else if(!dirtyBeforeReady){
     message('Lokale herstelkopie teruggevonden. Synchronisatie wordt hervat.');
     schedule(150);
    }else{
     active=false;message('Er zijn nieuwe lokale wijzigingen tijdens het laden. Maak een back-up en kies bewust een versie.');
    }
    return;
   }
   if(dirtyBeforeReady||!hooks.canApply()){
    message('De lokale gegevens zijn gewijzigd of worden bewerkt. Kies bewust een versie voordat je synchroniseert.');
    return;
   }
   if(!row&&revision>0){
    conflictNotice('De eerder gekoppelde accountgegevens ontbreken.');
    return;
   }
   if(row)safeApply(row);
   else if(revision===0){
    // Nieuwe lege accountkoppeling: pas upload bij de eerstvolgende wijziging.
   }
   revision=row?.revision||0;bindAccount(next.id,revision);
   active=true;
   message('Persoonlijke kookboekgegevens zijn gekoppeld en actueel.');
  }catch(error){
   if(token===epoch)message('Persoonlijke cloudgegevens konden niet worden geladen. Je lokale gegevens blijven staan: '+error.message,true);
  }finally{if(token===epoch)loading=false;}
 }
 async function chooseCloud(){
  if(!user||loading||sending)return;
  const id=user.id,token=epoch;loading=true;
  try{
   const row=await fetchRow(id);
   if(token!==epoch)return;
   cloudRow=row;
   if(!row){message('Er staan nog geen persoonlijke gegevens in je account. Gebruik “Dit apparaat naar account”.');return;}
   if(!hooks.canApply()){message('Sluit eerst je kookmodus of een open bewerking.',true);return;}
   if(!window.confirm('Dit vervangt de huidige persoonlijke gegevens op dit apparaat door de accountversie. Download eerst een back-up als je die wilt bewaren. Doorgaan?'))return;
   // Bij een openstaande lokale wijziging is een expliciet tweede akkoord verplicht.
   if((pending||conflict)&&root.prompt('Er zijn niet-gesynchroniseerde lokale wijzigingen. Typ VERVANG om deze na je eigen back-up te vervangen.')!=='VERVANG')return;
   safeApply(row);
   if(pending)clearJournal(pending);
   pending=null;conflict=false;revision=row.revision;
   bindAccount(id,revision);active=true;dirtyBeforeReady=false;
   message('Accountgegevens geladen. Toekomstige wijzigingen worden gesynchroniseerd.');
  }catch(error){message('Accountgegevens laden mislukt; de lokale versie blijft behouden: '+error.message,true);}
  finally{loading=false;}
 }
 async function chooseLocal(){
  if(!user||sending||loading)return;
  if(!hooks.canApply()){message('Sluit eerst je kookmodus of een open bewerking.',true);return;}
  const id=user.id,token=epoch;loading=true;
  try{
   const row=await fetchRow(id);
   if(token!==epoch)return;
   cloudRow=row;
   if(row){
    if(root.prompt('Je account bevat al persoonlijke gegevens. Dit apparaat vervangt die accountversie. Download eerst zo nodig je bestaande back-ups. Typ OVERSCHRIJF om door te gaan.')!=='OVERSCHRIJF')return;
   }else if(!window.confirm('Persoonlijke favorieten, boodschappen, voorraad en notities van dit apparaat voor het eerst opslaan in je account?'))return;
   revision=row?.revision||0;active=true;conflict=false;pending=null;dirtyBeforeReady=false;
   bindAccount(id,revision);
   if(!rememberDraft()){active=false;return;}
   schedule(0);
  }catch(error){message('Lokale gegevens konden niet naar je account: '+error.message,true);}
  finally{loading=false;}
 }
 function start(callbacks){
  hooks=callbacks;
  if(!enabled){message('Persoonlijke cloudsynchronisatie is niet actief; lokale gegevens blijven beschikbaar.');return;}
  const load=el('personalCloudLoad'),upload=el('personalCloudUpload'),sync=el('personalCloudSync');
  if(load)load.addEventListener('click',()=>{void chooseCloud();});
  if(upload)upload.addEventListener('click',()=>{void chooseLocal();});
  if(sync)sync.addEventListener('click',()=>{if(pending&&!conflict)void flush();else void refresh();});
  const download=el('personalCloudBackup');
  if(download)download.addEventListener('click',()=>hooks.download());
  message('Bestaande accounts en persoonlijke gegevens controleren…');
  async function loadSdk(){
   if(root.supabase?.createClient)return root.supabase;
   return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0';
    script.async=true;
    script.onload=()=>root.supabase?.createClient?resolve(root.supabase):reject(Error('Inlogmodule niet beschikbaar.'));
    script.onerror=()=>reject(Error('Inlogmodule kon niet worden geladen.'));
    document.head.appendChild(script);
   });
  }
  void (async()=>{
   try{
    const sdk=await loadSdk();
    client=sdk.createClient(cfg.url.replace(/\/$/,''),cfg.publishableKey,{
     auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    client.auth.onAuthStateChange((event,session)=>{
     setTimeout(()=>{
      if(event==='SIGNED_OUT')reset();
      else if(event==='SIGNED_IN'||event==='INITIAL_SESSION')void loadSession(session);
     },0);
    });
    const r=await client.auth.getSession();
    if(r.error)throw r.error;
    await loadSession(r.data.session);
    root.addEventListener('online',()=>{if(active&&pending&&!conflict)void flush();else void refresh();});
    document.addEventListener('visibilitychange',()=>{
     if(document.visibilityState!=='visible')return;
     if(active&&pending&&!conflict)void flush();else void refresh();
    });
    root.addEventListener('storage',event=>{
     if(!user||event.key!==journalKey(user.id))return;
     try{
      const latest=readJournal(user.id);
      if((latest?.nonce||null)!==(pending?.nonce||null)){
       conflictNotice('Een ander tabblad heeft een lokale wijziging gemaakt.');
      }
     }catch(error){conflictNotice('De lokale herstelkopie kan niet veilig worden gelezen.');}
    });
    root.setInterval(()=>{
     if(document.visibilityState!=='visible'||!active)return;
     if(pending&&!conflict)void flush();else void refresh();
    },60000);
   }catch(error){message('Inloggen voor persoonlijke gegevens niet beschikbaar. Je bestaande gegevens blijven lokaal: '+error.message,true);}
  })();
 }
 root.CookbookPersonalCloud={start,changed,enabled};
})(window);
