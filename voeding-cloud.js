/* Mijn Kookboek: optionele accountsync voor het voedingsdagboek.
   Geen service_role keys. Gebruik altijd Supabase Auth + RLS. */
(function(){
 'use strict';
 const config=window.COOKBOOK_CLOUD_CONFIG||{};
 const enabled=config.active===true&&/^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(config.url||'')&&
   typeof config.publishableKey==='string'&&config.publishableKey.length>20;
 const panel=()=>document.getElementById('cloudPanel');
 const el=id=>document.getElementById(id);
 let client=null,user=null,revision=0,ready=false,loading=false,loadId=0;
 let pending=null,inFlight=null,sending=false,conflict=false,flushTimer=null,hooks=null,onlineSyncing=false;
 function setStatus(message,isError=false){
  const e=el('cloudStatus');if(!e)return;
  e.textContent=message;e.classList.toggle('error',isError);
 }
 function display(){
  if(!panel())return;
  panel().hidden=!enabled;
  el('cloudLogin').hidden=Boolean(user);
  el('cloudUser').hidden=!user;
  if(user)el('cloudEmailLabel').textContent=user.email||'Ingelogde gebruiker';
  el('cloudRefresh').disabled=!ready;
 }
 function loadSdk(){
  if(window.supabase&&typeof window.supabase.createClient==='function')return Promise.resolve(window.supabase);
  return new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0';
   script.async=true;
   script.onload=()=>window.supabase&&window.supabase.createClient?resolve(window.supabase):
    reject(Error('Supabase is niet geladen.'));
   script.onerror=()=>reject(Error('Supabase kon niet worden geladen. Controleer je verbinding.'));
   document.head.appendChild(script);
  });
 }
 function reset(){
  loadId++;
  user=null;ready=false;loading=false;revision=0;
  pending=null;inFlight=null;sending=false;conflict=false;
  if(flushTimer!==null){clearTimeout(flushTimer);flushTimer=null;}
  if(hooks)hooks.onLogout();
  display();
 }
 async function remoteRow(identity){
  const result=await client.from('nutrition_diaries').select('diary,revision')
   .eq('user_id',identity.id).maybeSingle();
  if(result.error)throw result.error;
  return result.data;
 }
 async function loginSession(session){
  const identity=session?.user;
  if(!identity){reset();return;}
  if(user?.id===identity.id&&(ready||loading))return;
  // A different account must never see the previous account's open diary.
  if(user?.id&&user.id!==identity.id&&hooks)hooks.onLogout();
  const requestId=++loadId;
  user=identity;ready=false;loading=true;pending=null;revision=0;conflict=false;
  display();
  setStatus('Persoonlijk dagboek laden…');
  try{
   const remote=await remoteRow(identity);
   if(requestId!==loadId)return;
   revision=remote?.revision||0;
   let diary=remote?.diary||null;
   if(!remote&&hooks.hasLocal()){
    if(window.confirm('Er staat een lokaal voedingsdagboek op dit apparaat. Wil je dit eenmalig naar je nieuwe account overnemen? Kies Annuleren voor een leeg account.')){
     diary=hooks.getLocal();
    }
   }
   loading=false;ready=true;
   try{hooks.onData(diary);}
   catch(err){
    ready=false;
    setStatus('Cloudgegevens kunnen niet worden geopend: '+err.message,true);
    display();return;
   }
   display();
   if(!remote&&diary)enqueue(hooks.getState());
   else setStatus('Ingelogd. Je voedingsdagboek is gekoppeld en wordt gesynchroniseerd.');
  }catch(error){
   if(requestId!==loadId)return;
   loading=false;ready=false;
   setStatus('Gegevens laden is mislukt: '+error.message+'. Controleer de Supabase-configuratie en database.',true);
   display();
  }
 }
 function enqueue(data){
  if(!enabled||!user||!ready)return;
  pending=JSON.parse(JSON.stringify(data));
  if(conflict){
   setStatus('Wijzigingsconflict: maak eerst een back-up, kies daarna Cloud opnieuw laden.',true);
   return;
  }
  setStatus('Wijzigingen synchroniseren…');
  if(flushTimer!==null)clearTimeout(flushTimer);
  flushTimer=setTimeout(()=>{flushTimer=null;void flush();},650);
 }
 async function flush(){
  if(!user||!ready||sending||conflict||!pending)return;
  sending=true;
  const account=user.id;
  try{
   while(pending&&ready&&user?.id===account&&!conflict){
    const value=pending;pending=null;inFlight=value;
    let result;
    if(revision===0){
     result=await client.from('nutrition_diaries')
      .insert({user_id:account,diary:value,revision:1})
      .select('revision').single();
    }else{
     result=await client.from('nutrition_diaries')
      .update({diary:value,revision:revision+1,updated_at:new Date().toISOString()})
      .eq('user_id',account).eq('revision',revision)
      .select('revision').maybeSingle();
    }
    if(user?.id!==account)return;
    if(result.error||!result.data){
     // Keep newer edits if the user changed something while the request was pending.
     if(!pending)pending=value;
     inFlight=null;
     const likelyConflict=!result.error||result.error.code==='23505';
     if(likelyConflict){
      conflict=true;
      setStatus('Dit dagboek is ook op een ander apparaat gewijzigd. Exporteer zo nodig je huidige versie en kies Cloud opnieuw laden.',true);
     }else{
      setStatus('Cloudopslag is niet gelukt: '+result.error.message+'. Je wijzigingen staan voorlopig alleen op dit scherm. Kies Opnieuw synchroniseren.',true);
     }
     return;
    }
    revision=result.data.revision;
    inFlight=null;
   }
   if(ready&&user?.id===account)setStatus('Gesynchroniseerd met je persoonlijke account.');
  }catch(err){
   if(!pending&&inFlight)pending=inFlight;
   inFlight=null;
   setStatus('Geen verbinding met de cloud. Probeer opnieuw te synchroniseren.',true);
  }finally{sending=false;}
 }
 async function refresh(force=false){
  if(!user||!ready||loading||sending)return;
  if(pending&&!force){
   setStatus('Er zijn nog niet opgeslagen wijzigingen. Synchroniseer deze eerst.',true);
   return;
  }
  if(force&&pending&&!window.confirm('Er staan niet-gesynchroniseerde wijzigingen op dit scherm. Maak eerst een back-up. Wil je ze nu overschrijven met de cloudversie?'))return;
  if(onlineSyncing)return;
  onlineSyncing=true;
  try{
   const record=await remoteRow(user);
   if(!record){
    if(force){revision=0;pending=null;conflict=false;hooks.onData(null);}
    return;
   }
   if(record.revision!==revision||force){
    revision=record.revision;
    if(force){pending=null;conflict=false;}
    hooks.onData(record.diary);
    setStatus('Nieuwste cloudversie geladen.');
   }else if(force)setStatus('Je dagboek was al bijgewerkt.');
  }catch(error){
   setStatus('Cloudversie laden is mislukt: '+error.message,true);
  }finally{onlineSyncing=false;}
 }
 async function start(callbacks){
  hooks=callbacks;
  if(!enabled)return;
  display();
  setStatus('Accounts worden voorbereid…');
  el('cloudLoginForm').addEventListener('submit',async event=>{
   event.preventDefault();
   if(!client){setStatus('De inlogdienst is niet beschikbaar.',true);return;}
   const email=el('cloudEmail').value.trim();
   if(!email||!el('cloudEmail').checkValidity()){setStatus('Vul een geldig e-mailadres in.',true);return;}
   el('cloudSignIn').disabled=true;
   try{
    const result=await client.auth.signInWithOtp({
     email,options:{emailRedirectTo:location.origin+location.pathname}
    });
    if(result.error)throw result.error;
    setStatus('Je ontvangt een eenmalige inloglink per e-mail. Open de link om in te loggen.');
   }catch(err){setStatus('Inloglink verzenden is mislukt: '+err.message,true);}
   finally{el('cloudSignIn').disabled=false;}
  });
  el('cloudSignOut').onclick=async()=>{
   if((pending||sending)&&!window.confirm('Niet alle wijzigingen zijn gesynchroniseerd. Wil je toch uitloggen?'))return;
   const result=await client.auth.signOut();
   if(result.error)setStatus('Uitloggen mislukt: '+result.error.message,true);
   else{reset();setStatus('Uitgelogd. Je persoonlijke dagboek is gesloten.');}
  };
  el('cloudRefresh').onclick=()=>{if(conflict)void refresh(true);else if(pending)void flush();else void refresh(true);};
  try{
   const sdk=await loadSdk();
   client=sdk.createClient(config.url.replace(/\/$/,''),config.publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
   });
   client.auth.onAuthStateChange((event,session)=>{
    // Never await network/database calls inside Supabase's synchronous auth callback.
    setTimeout(()=>{
     if(event==='SIGNED_OUT'){reset();setStatus('Uitgelogd. Log opnieuw in om je persoonlijke gegevens te bekijken.');}
     else if(event==='SIGNED_IN'||event==='INITIAL_SESSION'){
      if(session?.user)void loginSession(session);
      else if(event==='INITIAL_SESSION'){reset();setStatus('Log in om je persoonlijke voedingsdagboek te openen.');}
     }
    },0);
   });
   const {data,error}=await client.auth.getSession();
   if(error)throw error;
   if(data.session?.user)await loginSession(data.session);
   else{reset();setStatus('Log in met je e-mailadres om je persoonlijke voedingsdagboek te openen.');}
   window.addEventListener('online',()=>{
    if(!ready)return;
    if(pending&&!conflict)void flush();else if(!pending)void refresh();
   });
   document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&ready&&!pending)void refresh();
   });
   window.addEventListener('beforeunload',event=>{
    if(!pending&&!sending)return;
    event.preventDefault();
    event.returnValue='';
   });
  }catch(error){setStatus('Accounts kunnen nog niet worden gestart: '+error.message,true);}
 }
 window.CookbookCloud={enabled,start,enqueue,retry(){if(pending)void flush();else void refresh();}};
})();
