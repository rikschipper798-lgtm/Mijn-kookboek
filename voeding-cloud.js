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
 let client=null,hooks=null,user=null,revision=0,ready=false,loading=false;
 let draft=null,conflict=false,sending=false,refreshing=false,timer=null;
 let generation=0,edits=0;

 function notify(message,error=false){
  const node=el('cloudStatus');if(!node)return;
  node.textContent=message;node.classList.toggle('error',error);
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
  generation++;stopTimer();
  user=null;revision=0;ready=false;loading=false;draft=null;
  sending=false;refreshing=false;conflict=false;edits=0;
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
 function enqueue(data){
  if(!enabled||!user||!ready)return false;
  let previous;
  try{previous=readLocal(user.id);}
  catch(err){conflict=true;notify(err.message,true);return false;}
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
   notify('Wijziging veilig op dit apparaat opgeslagen; cloudsync volgt.');
   schedule();
  }
  return true;
 }
 async function flush(){
  if(!user||!ready||sending||conflict||!draft)return;
  sending=true;const account=user.id,token=generation;
  try{
   while(draft&&!conflict&&ready&&user?.id===account&&generation===token){
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
     const collision=!response.data||response.error?.code==='23505';
     if(collision){
      conflict=true;
      notify('Cloudconflict: je lokale versie is veilig opgeslagen. Exporteer een back-up en kies daarna bewust Cloud opnieuw laden.',true);
     }else{
      notify('Verbinding of cloudopslag mislukt. Je laatste wijzigingen blijven veilig op dit apparaat staan. Gebruik Opnieuw synchroniseren.',true);
     }
     return;
    }
    revision=response.data.revision;
    let stored;
    try{stored=readLocal(account);}
    catch(err){conflict=true;notify(err.message,true);return;}
    if(!stored||stored.nonce!==draft?.nonce){
     conflict=true;
     notify('Er is ook een wijziging vanuit een ander tabblad. De herstelkopie wordt niet overschreven.',true);
     return;
    }
    if(draft.nonce===sent.nonce){
     if(!deleteLocal(sent))return;
     draft=null;
    }else{
     const revised={...draft,baseRevision:revision};
     if(!writeLocal(revised)){
      conflict=true;
      notify('Nieuwe wijzigingen zijn lokaal behouden, maar de herstelstatus kan niet worden bijgewerkt. Exporteer je dagboek.',true);
      return;
     }
     draft=revised;
    }
   }
   if(token===generation&&!draft&&!conflict)notify('Gesynchroniseerd met je persoonlijke account.');
  }catch(err){
   if(token===generation)notify('De cloud is tijdelijk niet bereikbaar. Je wijzigingen blijven lokaal opgeslagen. Probeer opnieuw te synchroniseren.',true);
  }finally{if(token===generation)sending=false;}
 }
 async function loadSession(session){
  const account=session?.user;
  if(!account){reset();return;}
  if(user?.id===account.id&&(loading||ready))return;
  const token=++generation;
  stopTimer();user=account;ready=false;loading=true;draft=null;
  revision=0;conflict=false;sending=false;refreshing=false;edits=0;
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
   loading=false;ready=false;
   notify('Persoonlijk dagboek laden is mislukt: '+err.message+'. Je lokale herstelkopie blijft behouden.',true);
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
   if(edits!==editMark||sending||(draft&&!force)){
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
    const r=await client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
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
