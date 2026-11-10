/* Mijn Kookboek: persoonlijke voedingsdagboeken met herstelbare cloudsync.
   Per account wordt eerst synchroon een lokale herstelkopie bewaard.
   Cloudschrijven gebruikt een revisiecheck; bij conflict nooit stilzwijgend vervangen. */
(function(){
 'use strict';
 const config=window.COOKBOOK_CLOUD_CONFIG||{};
 const enabled=config.active===true&&/^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(config.url||'')&&
   typeof config.publishableKey==='string'&&config.publishableKey.length>20;
 const el=id=>document.getElementById(id);
 const keyPrefix='mijn-kookboek-cloud-herstel-v1:'+String(config.url||'').replace(/\/$/,'')+':';
 const storageKey=id=>keyPrefix+id;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const makeNonce=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,13);
 let client=null,hooks=null,user=null,revision=0,ready=false,loading=false,authChecked=false;
 let draft=null,conflict=false,sending=false,refreshing=false,timer=null;
 let generation=0,edits=0,needsVerification=false;
 let historyRows=new Map();

 function notify(message,error=false){
  const node=el('cloudStatus');
  if(node){node.textContent=message;node.classList.toggle('error',error);}
  // De status is dezelfde feitelijke syncstatus als in het accountpaneel.
  // Geen afzonderlijke UI-gissingen over succesvolle uploads.
  if(hooks&&typeof hooks.onStatus==='function'){
   hooks.onStatus({
    loggedIn:user?true:authChecked?false:null,ready,pending:Boolean(draft),conflict,
    error,message
   });
  }
 }
 function view(){
  if(!el('cloudPanel'))return;
  el('cloudPanel').hidden=!enabled;
  el('cloudLogin').hidden=Boolean(user);
  el('cloudUser').hidden=!user;
  if(user)el('cloudEmailLabel').textContent=user.email||'Ingelogde gebruiker';
  el('cloudRefresh').disabled=!ready;
 }
 function readLocal(id){
  const text=window.localStorage.getItem(storageKey(id));
  if(text===null)return null;
  let obj;
  try{obj=JSON.parse(text);}catch(e){throw Error('De lokale herstelkopie is onleesbaar. Maak eerst een back-up; er wordt niets overschreven.');}
  if(!obj||obj.version!==1||obj.userId!==id||!Number.isSafeInteger(obj.baseRevision)||
     obj.baseRevision<0||typeof obj.nonce!=='string'||!obj.nonce||
     !obj.diary||typeof obj.diary!=='object'||Array.isArray(obj.diary))
    throw Error('De lokale herstelkopie heeft een onbekend formaat. Er wordt niets overschreven.');
  return obj;
 }
 function writeLocal(value){
  try{
   window.localStorage.setItem(storageKey(value.userId),JSON.stringify(value));
   return true;
  }catch(error){
   notify('Kan de wijziging niet veilig op dit apparaat opslaan. Controleer je beschikbare browseropslag; de wijziging is niet doorgevoerd.',true);
   return false;
  }
 }
 function deleteLocal(value){
  try{
   const stored=readLocal(value.userId);
   if(stored&&stored.nonce!==value.nonce){
    conflict=true;
    notify('Een ander tabblad heeft een nieuwere herstelkopie. Er wordt niets overschreven. Download een back-up en herlaad bewust.',true);
    return false;
   }
   window.localStorage.removeItem(storageKey(value.userId));
   return true;
  }catch(err){
   notify('De upload is gelukt, maar het lokale herstelbestand kon niet worden bijgewerkt. Exporteer je dagboek voordat je opnieuw inlogt.',true);
   return false;
  }
 }
 function stopTimer(){
  if(timer!==null){clearTimeout(timer);timer=null;}
 }
 function reset(){
  authChecked=true;
  generation++;stopTimer();
  user=null;revision=0;ready=false;loading=false;draft=null;
  sending=false;refreshing=false;conflict=false;edits=0;needsVerification=false;
  historyRows.clear();
  if(hooks)hooks.onLogout();
  view();
 }
 async function fetchRow(account){
  const r=await client.from('nutrition_diaries').select('diary,revision')
   .eq('user_id',account.id).maybeSingle();
  if(r.error)throw r.error;
  return r.data;
 }
 function schedule(ms=650){
  stopTimer();
  timer=setTimeout(()=>{timer=null;void flush();},ms);
 }

 function isSameDiary(first,second){
  if(!first||!second)return false;
  return JSON.stringify(hooks.validateData(first))===JSON.stringify(hooks.validateData(second));
 }
 function acknowledge(sent,newRevision,account){
  revision=newRevision;
  let stored;
  try{stored=readLocal(account);}
  catch(err){conflict=true;notify('Herstelkopie controleren is mislukt: '+err.message,true);return false;}
  if(!stored||stored.nonce!==draft?.nonce){
   conflict=true;
   notify('Een ander tabblad heeft de herstelkopie veranderd. Er wordt niets gewist.',true);
   return false;
  }
  if(draft.nonce===sent.nonce){
   if(!deleteLocal(sent))return false;
   draft=null;
  }else{
   const next={...draft,baseRevision:revision};
   if(!writeLocal(next)){
    conflict=true;
    notify('Een nieuwere wijziging blijft lokaal bewaard; herstelstatus kon niet worden bijgewerkt.',true);
    return false;
   }
   draft=next;
  }
  return true;
 }
 function enqueue(data){
  if(!enabled||!user||!ready)return false;
  let previous;
  try{previous=readLocal(user.id);}
  catch(err){conflict=true;notify('De browseropslag is niet beschikbaar; deze wijziging is niet opgeslagen. '+err.message,true);return false;}
  if(previous&&(!draft||previous.nonce!==draft.nonce)){
   conflict=true;
   notify('Een ander tabblad heeft gegevens gewijzigd. Deze invoer is niet opgeslagen; open het dagboek opnieuw en controleer de herstelkopie.',true);
   return false;
  }
  const record={
   version:1,userId:user.id,
   baseRevision:draft?draft.baseRevision:revision,
   nonce:makeNonce(),diary:clone(data),savedAt:new Date().toISOString()
  };
  if(!writeLocal(record))return false;
  draft=record;edits++;
  if(conflict){
   notify('Je wijzigingen zijn lokaal bewaard, maar er is een cloudconflict. Exporteer je dagboek en kies daarna bewust Cloud opnieuw laden.',true);
  }else{
   notify(needsVerification?'Wijziging lokaal bewaard; bij verbinding wordt eerst de cloudversie gecontroleerd.':'Wijziging lokaal bewaard; cloudsync volgt.');
   schedule();
  }
  return true;
 }
 async function flush(){
  if(!user||!ready||sending||conflict||!draft)return;
  sending=true;const account=user.id,token=generation;
  try{
   while(draft&&!conflict&&ready&&user?.id===account&&generation===token){
    if(needsVerification){
     // The page was reopened while offline: confirm the server revision
     // before making any write based on the recovered journal.
     const live=await fetchRow({id:account});
     if(token!==generation||user?.id!==account)return;
     const liveRevision=live?.revision||0;
     if(liveRevision!==draft.baseRevision){
      if(live&&JSON.stringify(hooks.validateData(live.diary))===JSON.stringify(hooks.validateData(draft.diary))){
       if(!deleteLocal(draft))return;
       revision=liveRevision;draft=null;needsVerification=false;
       notify('Deze herstelkopie stond al in de cloud. Je dagboek is gesynchroniseerd.');
       return;
      }
      conflict=true;needsVerification=false;
      notify('De cloud is intussen gewijzigd. Je lokale dagboek blijft bewaard: exporteer een back-up en kies daarna bewust de cloudversie.',true);
      return;
     }
     revision=liveRevision;needsVerification=false;
    }
    const sent=draft;
    let response;
    if(sent.baseRevision===0){
     response=await client.from('nutrition_diaries')
      .insert({user_id:account,diary:sent.diary,revision:1})
      .select('revision').single();
    }else{
     response=await client.from('nutrition_diaries')
      .update({diary:sent.diary,revision:sent.baseRevision+1,updated_at:new Date().toISOString()})
      .eq('user_id',account).eq('revision',sent.baseRevision)
      .select('revision').maybeSingle();
    }
    if(token!==generation||user?.id!==account)return;
    if(response.error||!response.data){
     // A request can commit remotely but lose its HTTP acknowledgement.
     // Read the server version before declaring a conflict or retrying.
     let live;
     try{live=await fetchRow({id:account});}
     catch(err){
      notify('Cloudresultaat is onzeker door een verbindingsfout. Je herstelkopie blijft staan. Probeer later opnieuw.',true);
      return;
     }
     if(token!==generation||user?.id!==account)return;
     if(live&&isSameDiary(live.diary,sent.diary)){
      if(!acknowledge(sent,live.revision,account))return;
      continue;
     }
     if((live?.revision||0)!==sent.baseRevision){
      conflict=true;
      notify('Cloudconflict: de server heeft een andere versie. Je lokale dagboek is behouden. Maak een back-up en kies daarna bewust Cloud opnieuw laden.',true);
     }else{
      notify('De cloud heeft de wijziging niet opgeslagen. Je herstelkopie blijft veilig op dit apparaat. Probeer opnieuw zodra de verbinding werkt.',true);
     }
     return;
    }
    if(!acknowledge(sent,response.data.revision,account))return;
   }
   if(token===generation&&!draft&&!conflict)notify('Gesynchroniseerd met je persoonlijke account.');
  }catch(err){
   if(token===generation)notify('De cloud is tijdelijk niet bereikbaar. Je wijzigingen blijven lokaal opgeslagen. Probeer opnieuw te synchroniseren.',true);
  }finally{if(token===generation)sending=false;}
 }
 async function loadSession(session){
  const account=session?.user;
  if(!account){reset();return;}
  authChecked=true;
  if(user?.id===account.id&&(loading||ready))return;
  const token=++generation;
  stopTimer();user=account;ready=false;loading=true;draft=null;
  historyRows.clear();el('cloudHistoryOptions').hidden=true;
  revision=0;conflict=false;sending=false;refreshing=false;edits=0;needsVerification=false;
  if(hooks)hooks.onLogout();
  view();notify('Persoonlijk dagboek en lokale herstelkopie laden…');
  try{
   const remote=await fetchRow(account);
   if(token!==generation)return;
   const remoteRevision=remote?.revision||0;
   const saved=readLocal(account.id);
   revision=remoteRevision;
   let diary=remote?.diary||null;
   if(saved){
    draft=saved;
    diary=saved.diary;
    if(saved.baseRevision!==remoteRevision){
     // Network reply may have reached Supabase just before browser/tab closed.
     // If its exact draft is already in the cloud, acknowledge it after reload.
     if(remote&&JSON.stringify(hooks.validateData(remote.diary))===JSON.stringify(hooks.validateData(saved.diary))){
      if(!deleteLocal(saved)){ready=false;loading=false;return;}
      draft=null;diary=remote.diary;
     }else conflict=true;
    }
   }else if(!remote&&hooks.hasLocal()){
    if(window.confirm('Je hebt al een lokaal voedingsdagboek. Wil je dit eenmalig overnemen in je persoonlijke cloudaccount?')){
     diary=hooks.getLocal();
    }
   }
   loading=false;ready=true;
   // For first-time migration, persist BEFORE rendering or attempting cloud upload.
   if(!saved&&!remote&&diary){
    if(!enqueue(diary)){ready=false;notify('Overname nog niet opgeslagen. Je oorspronkelijke lokale dagboek is behouden.',true);return;}
   }
   try{hooks.onData(diary);}
   catch(err){
    ready=false;
    notify('Dagboek kan niet worden ingelezen: '+err.message+'. De oorspronkelijke herstelkopie blijft behouden.',true);
    return;
   }
   view();
   if(conflict){
    notify('De cloud is op een ander apparaat gewijzigd. Je niet-geüploade lokale dagboek is hersteld. Exporteer dit eerst voordat je de cloudversie kiest.',true);
   }else if(draft){
    notify('Niet-gesynchroniseerde wijzigingen uit deze browser hersteld. Ze worden opnieuw verstuurd.');
    schedule(100);
   }else notify('Ingelogd. Dagboek actueel en gesynchroniseerd.');
  }catch(err){
   if(token!==generation)return;
   loading=false;
   // A valid cached Supabase session can recover an already saved draft
   // while disconnected. Its base revision is verified before any upload.
   try{
    const recovered=readLocal(account.id);
    if(recovered){
     draft=recovered;revision=recovered.baseRevision;needsVerification=true;
     ready=true;conflict=false;
     hooks.onData(recovered.diary);
     view();
     notify('Geen cloudverbinding. Je lokale herstelkopie is geopend; wijzigingen blijven bewaard. Synchronisatie hervat wanneer de verbinding terugkomt.',true);
     return;
    }
   }catch(recoveryError){
    notify('Lokale herstelkopie kon niet worden geopend: '+recoveryError.message,true);
   }
   ready=false;
   notify('Persoonlijk dagboek laden is mislukt: '+err.message+'. Eventuele lokale gegevens blijven behouden.',true);
   view();
  }
 }
 async function refresh(force=false){
  if(!user||!ready||loading||sending||refreshing)return;
  if(draft&&!force){
   notify('Er staan nog lokale wijzigingen klaar. Synchroniseer eerst of exporteer voordat je de cloudversie laadt.',true);return;
  }
  if(force&&draft&&!window.confirm('Je hebt niet-gesynchroniseerde wijzigingen. Exporteer eerst een JSON-back-up. Wil je de lokale herstelkopie echt vervangen door de cloudversie?'))return;
  const token=generation,account=user.id,editMark=edits;
  refreshing=true;
  try{
   const remote=await fetchRow(user);
   if(token!==generation||user?.id!==account)return;
   // A cloud read must never win over an edit saved while it was in flight.
   if(edits!==editMark||sending||(conflict&&!force)||(draft&&!force)){
    notify('Cloudantwoord genegeerd: ondertussen zijn er lokale wijzigingen opgeslagen.',true);
    return;
   }
   if(remote?.revision===revision&&!force)return;
   // Verify incoming data BEFORE discarding any locally saved recovery copy.
   const validated=hooks.validateData(remote?.diary||null);
   if(force&&draft&&!deleteLocal(draft))return;
   revision=remote?.revision||0;draft=null;conflict=false;
   hooks.onData(validated);
   notify('Nieuwste cloudversie geladen.');
  }catch(err){
   if(token===generation)notify('Cloudgegevens ophalen mislukt; lokale gegevens zijn niet overschreven.',true);
  }finally{if(token===generation)refreshing=false;}
 }
 // Bewaar uitsluitend de interne receptkeuze in de magic-link redirect.
 // Geen willekeurige URL-parameters of door de gebruiker ingestelde bestemmingen.
 function loginRedirectUrl(){
  const base=location.origin+location.pathname;
  const query=new URLSearchParams(location.search||'');
  const recipe=query.get('recept');
  if(!recipe||!/^[a-zA-Z0-9_-]{1,150}$/.test(recipe))return base;
  const selection=new URLSearchParams({recept:recipe});
  const variant=query.get('variant');
  if(variant&&/^[a-zA-Z0-9_-]{1,150}$/.test(variant))selection.set('variant',variant);
  return base+'?'+selection.toString();
 }
 function loadSdk(){
  if(window.supabase&&typeof window.supabase.createClient==='function')return Promise.resolve(window.supabase);
  return new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0';
   script.async=true;
   script.onload=()=>window.supabase?.createClient?resolve(window.supabase):reject(Error('Supabase is niet geladen.'));
   script.onerror=()=>reject(Error('De inlogdienst kon niet worden geladen.'));
   document.head.appendChild(script);
  });
 }
 async function start(callbacks){
  hooks=callbacks;
  if(!enabled)return;
  view();notify('Persoonlijke accounts voorbereiden…');
  el('cloudLoginForm').addEventListener('submit',async event=>{
   event.preventDefault();
   if(!client){notify('De inlogdienst is nog niet beschikbaar.',true);return;}
   const email=el('cloudEmail').value.trim();
   if(!email||!el('cloudEmail').checkValidity()){notify('Vul een geldig e-mailadres in.',true);return;}
   el('cloudSignIn').disabled=true;
   try{
    const r=await client.auth.signInWithOtp({email,options:{emailRedirectTo:loginRedirectUrl()}});
    if(r.error)throw r.error;
    notify('De eenmalige inloglink is verstuurd. Open deze via je e-mail.');
   }catch(err){notify('Inloglink verzenden mislukt: '+err.message,true);}
   finally{el('cloudSignIn').disabled=false;}
  });
  el('cloudSignOut').onclick=async()=>{
   if(draft&&!window.confirm('Je hebt wijzigingen die nog niet in de cloud staan. Ze blijven als lokale herstelkopie bewaard voor dit account. Toch uitloggen?'))return;
   const r=await client.auth.signOut();
   if(r.error)notify('Uitloggen mislukt: '+r.error.message,true);
   else{reset();notify('Uitgelogd. Eventuele herstelkopie blijft bewaard voor het juiste account.');}
  };
  el('cloudBackup').onclick=()=>{
   const options=el('secureBackupOptions');
   options.open=true;
   if(options.scrollIntoView)options.scrollIntoView({behavior:'smooth',block:'center'});
   el('backupPass').focus();
  };
  el('cloudDeleteAccount').onclick=async()=>{
   if(!client||!user||!ready){notify('Log eerst in om het account te verwijderen.',true);return;}
   const typed=window.prompt('Dit verwijdert je account en alle cloudregistraties definitief. Typ VERWIJDER om door te gaan.');
   if(typed!=='VERWIJDER')return;
   if(!window.confirm('Laatste bevestiging: dit account en het voedingsdagboek worden definitief verwijderd. Een eventueel gedownload back-upbestand blijft van jou. Doorgaan?'))return;
   const button=el('cloudDeleteAccount');
   button.disabled=true;notify('Je account wordt verwijderd…');
   const accountId=user.id;
   try{
    const result=await client.functions.invoke('delete-my-account',{body:{confirmation:'VERWIJDER'}});
    if(result.error||result.data?.deleted!==true)throw Error(result.error?.message||result.data?.error||'Onbekende serverreactie');
    // Wis uitsluitend gegevens van dit ingelogde dagboekaccount en de oude
    // lokale dagboekkopie. Andere gebruikersaccounts worden niet aangeraakt.
    try{
     window.localStorage.removeItem(storageKey(accountId));
     window.localStorage.removeItem('mijn-kookboek-voedingsdagboek');
    }catch(error){notify('Cloudaccount verwijderd, maar browsergegevens konden niet worden gewist. Wis de websitegegevens van deze browser handmatig.',true);}
    await client.auth.signOut();
    reset();
    notify('Je account en cloudgegevens zijn verwijderd. Controleer eventueel gedownloade back-ups zelf.');
   }catch(err){
    notify('Verwijderen is niet bevestigd: '+err.message+'. Controleer eerst je accountstatus voordat je opnieuw probeert.',true);
   }finally{button.disabled=false;}
  };
  el('cloudHistoryLoad').onclick=async()=>{
   if(!user||!ready||draft||sending||conflict){
    notify('Synchroniseer eerst je openstaande wijzigingen voordat je een eerdere versie ophaalt.',true);return;
   }
   const token=generation,account=user.id;
   el('cloudHistoryLoad').disabled=true;
   el('cloudHistoryStatus').textContent='Eerdere versies ophalen…';
   try{
    const result=await client.from('nutrition_diary_history')
     .select('revision,saved_at,diary').eq('user_id',account)
     .order('revision',{ascending:false}).limit(3);
    if(token!==generation||user?.id!==account)return;
    if(result.error)throw result.error;
    historyRows.clear();
    for(const entry of result.data||[]){
     const rev=Number(entry.revision);
     if(!Number.isSafeInteger(rev)||rev<1)continue;
     historyRows.set(String(rev),entry);
    }
    el('cloudHistoryOptions').hidden=historyRows.size===0;
    el('cloudHistorySelect').innerHTML=[...historyRows.entries()].map(([rev,row])=>
      '<option value="'+rev+'">Versie '+rev+' · '+new Date(row.saved_at).toLocaleString('nl-NL')+'</option>').join('');
    el('cloudHistoryStatus').textContent=historyRows.size
      ?historyRows.size+' eerdere versie(s) beschikbaar.':'Er zijn nog geen eerdere versies opgeslagen.';
   }catch(error){
    el('cloudHistoryStatus').textContent='Ophalen mislukt: '+error.message;
   }finally{el('cloudHistoryLoad').disabled=false;}
  };
  el('cloudHistoryRestore').onclick=()=>{
   if(!user||!ready||draft||sending||conflict){
    notify('Los eerst de openstaande synchronisatie op voordat je een versie herstelt.',true);return;
   }
   const entry=historyRows.get(el('cloudHistorySelect').value);
   if(!entry){notify('Kies eerst een versie.',true);return;}
   if(!window.confirm('Je gaat een oudere dagboekversie herstellen. De huidige versie wordt als herstelversie bewaard zodra de cloud de wijziging accepteert. Doorgaan?'))return;
   try{
    const validated=hooks.validateData(entry.diary);
    if(!hooks.restoreVersion(validated))throw Error('De herstelactie is niet veilig opgeslagen.');
    historyRows.clear();el('cloudHistoryOptions').hidden=true;
    notify('De vorige dagboekversie is lokaal hersteld. Wacht tot de cloudsync is bevestigd.');
   }catch(error){notify('Herstellen is mislukt: '+error.message,true);}
  };
  el('cloudRefresh').onclick=()=>{if(draft&&!conflict)void flush();else void refresh(Boolean(conflict));};
  try{
   const sdk=await loadSdk();
   client=sdk.createClient(config.url.replace(/\/$/,''),config.publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
   });
   client.auth.onAuthStateChange((event,session)=>{
    setTimeout(()=>{
     if(event==='SIGNED_OUT'){reset();notify('Uitgelogd. Log in om je dagboek te bekijken.');}
     else if(event==='SIGNED_IN'||event==='INITIAL_SESSION'){
      if(session?.user)void loadSession(session);
      else if(event==='INITIAL_SESSION'&&!user){view();notify('Log in om je persoonlijke dagboek te openen.');}
     }
    },0);
   });
   const {data,error}=await client.auth.getSession();
   if(error)throw error;
   authChecked=true;
   if(data.session?.user)await loadSession(data.session);
   else{view();notify('Log in om je persoonlijke voedingsdagboek te openen.');}
   window.addEventListener('online',()=>{
    if(!ready)return;
    if(draft&&!conflict)void flush();
    else if(!draft)void refresh();
   });
   document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible'||!ready)return;
    if(draft&&!conflict)void flush();
    else if(!draft)void refresh();
   });
   window.addEventListener('storage',event=>{
    if(!user||event.key!==storageKey(user.id))return;
    try{
     const stored=readLocal(user.id);
     if((stored?.nonce||null)!==(draft?.nonce||null)){
      conflict=true;stopTimer();
      notify('Hetzelfde account is in een ander tabblad gewijzigd. Exporteer zo nodig je dagboek en herlaad voordat je doorgaat.',true);
     }
    }catch(err){conflict=true;notify(err.message,true);}
   });
  }catch(err){notify('Persoonlijke accounts konden niet worden gestart: '+err.message,true);}
 }
 window.CookbookCloud={enabled,start,enqueue,retry(){if(draft&&!conflict)void flush();else void refresh(Boolean(conflict));}};
})();
