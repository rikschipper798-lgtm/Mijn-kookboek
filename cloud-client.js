/* Eén Supabase-client per pagina, ook wanneer beide gegevensonderdelen starten. */
(function(root){
 'use strict';let promise;
 root.CookbookClient={get(){
  if(promise)return promise;
  promise=(async()=>{
   if(!root.supabase?.createClient)await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0';script.async=true;
    script.onload=resolve;script.onerror=()=>reject(Error('De inlogdienst kon niet worden geladen.'));
    document.head.appendChild(script);
   });
   if(!root.supabase?.createClient)throw Error('De inlogdienst is niet beschikbaar.');
   const config=root.COOKBOOK_CLOUD_CONFIG;
   return root.supabase.createClient(config.url.replace(/\/$/,''),config.publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
   });
  })().catch(error=>{promise=null;throw error;});return promise;
 }};
})(window);
