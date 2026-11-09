'use strict';
// Bestandsversie: verhoog deze waarde bij wijzigingen aan offline infrastructuur.
// index.html en recepten.json worden online altijd opnieuw opgehaald.
const CACHE_VERSION='2026-11-09-diary-durable-recovery-v11';
const CORE_CACHE='mijn-kookboek-pwa-core-'+CACHE_VERSION;
const IMAGE_CACHE='mijn-kookboek-pwa-images-'+CACHE_VERSION;
const CACHE_PREFIX='mijn-kookboek-pwa-';
const SCOPE=self.registration.scope;
const ROOT=new URL('./',SCOPE);
const CORE_ASSETS=['index.html','voeding.html','voeding-cloud.js','cloud-config.js','instellen-vaste-maaltijden.html','pantry.js','recepten.json','manifest.webmanifest',
 'icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png'];
// Afbeeldingen komen uit dezelfde receptenlijst die de website gebruikt.
// Zowel basisrecepten als varianten worden meegenomen. Dubbele paden slechts één keer.
function recipeImagePaths(data){
 if(!Array.isArray(data))return [];
 const unique=new Set();
 const add=path=>{
  if(typeof path!=='string'||!/^images\/[A-Za-z0-9_.\/-]+\.(?:webp|avif|png|jpe?g|svg)$/i.test(path))return;
  if(path.split('/').includes('..')||path.includes('//'))return;
  unique.add(path);
 };
 for(const recipe of data){
  if(!recipe||typeof recipe!=='object')continue;
  add(recipe.image);
  if(Array.isArray(recipe.variants)){
   for(const variant of recipe.variants)if(variant&&typeof variant==='object')add(variant.image);
  }
 }
 return [...unique];
}
// Kleine parallelle batches om de verbinding niet onnodig te belasten.
// Ontbrekende afbeeldingen blokkeren het offline beschikbaar maken van recepten nooit.
async function syncRecipeImages(data){
 const paths=recipeImagePaths(data);
 const photos=await caches.open(IMAGE_CACHE);
 let index=0,loaded=0,failed=0;
 await Promise.all(Array.from({length:Math.min(4,paths.length)},async()=>{
  while(index<paths.length){
   const path=paths[index++];
   const request=new Request(new URL(path,ROOT),{cache:'reload'});
   try{
    if(await photos.match(request))continue;
    const response=await fetch(request);
    if(!response.ok)throw new Error('HTTP '+response.status);
    await photos.put(request,response.clone());
    loaded++;
   }catch(error){failed++;}
  }
 }));
 if(failed)console.warn('Offline afbeeldingen: '+failed+' van '+paths.length+' nog niet opgeslagen; volgende online bezoek probeert opnieuw.');
 return {total:paths.length,loaded,failed};
}
async function syncRecipeImagesFromResponse(response){
 try{return await syncRecipeImages(await response.json())}
 catch(error){
  console.warn('Offline afbeeldingensynchronisatie kon niet worden uitgevoerd.',error);
  return null;
 }
}

self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  // Zonder volledig basisscherm en recepten activeren we niet als offline app.
  const core=await caches.open(CORE_CACHE);
  await core.addAll(CORE_ASSETS.map(path=>new Request(new URL(path,ROOT),{cache:'reload'})));
  // Gebruik de zojuist opgeslagen receptgegevens als bron voor alle foto's.
  // Bij een ontbrekende foto werkt het kookboek offline verder.
  const recipeResponse=await core.match(new URL('recepten.json',ROOT));
  if(recipeResponse)await syncRecipeImagesFromResponse(recipeResponse);
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keep=new Set([CORE_CACHE,IMAGE_CACHE]);
  const all=await caches.keys();
  await Promise.all(all.filter(k=>k.startsWith(CACHE_PREFIX)&&!keep.has(k)).map(k=>caches.delete(k)));
  await self.clients.claim();
 })());
});
self.addEventListener('message',event=>{
 if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();
});
async function networkFirst(request,cacheName,fallbackUrl=null,onNetworkUpdate=null){
 const cache=await caches.open(cacheName);
 try{
  const response=await fetch(request);
  if(response.ok){
   try{await cache.put(request,response.clone())}catch(e){}
   if(onNetworkUpdate)onNetworkUpdate(response.clone());
   return response;
  }
  const previous=await cache.match(request)||(fallbackUrl?await cache.match(fallbackUrl):null);
  return previous||response;
 }catch(error){
  const previous=await cache.match(request)||(fallbackUrl?await cache.match(fallbackUrl):null);
  if(previous)return previous;
  return new Response('Offline en dit bestand is nog niet opgeslagen.',{
   status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
 }
}
async function cacheFirst(request,cacheName){
 const cache=await caches.open(cacheName);
 const stored=await cache.match(request);
 if(stored)return stored;
 try{
  const response=await fetch(request);
  if(response.ok)try{await cache.put(request,response.clone())}catch(e){}
  return response;
 }catch(error){
  return new Response('',{status:503,statusText:'Offline'});
 }
}
async function imageWithRefresh(event){
 const request=event.request;
 const cache=await caches.open(IMAGE_CACHE);
 const previous=await cache.match(request);
 const update=(async()=>{
  const response=await fetch(request);
  if(response.ok)try{await cache.put(request,response.clone())}catch(e){}
  return response;
 })();
 if(previous){
  event.waitUntil(update.catch(()=>{}));
  return previous;
 }
 try{return await update}catch(error){
  return new Response('',{status:503,statusText:'Offline'});
 }
}
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
 const pathname=url.pathname.slice(ROOT.pathname.length);
 if(request.mode==='navigate'||pathname===''||pathname==='index.html'){
  event.respondWith(networkFirst(request,CORE_CACHE,new URL(pathname==='voeding.html'?'voeding.html':'index.html',ROOT)));
 }else if(pathname==='recepten.json'){
  event.respondWith(networkFirst(request,CORE_CACHE,null,response=>{
   // Zodra online een gewijzigde receptenlijst binnenkomt, worden ook nieuwe
   // receptfoto's en variantfoto's offline opgeslagen, zonder nieuwe sw.js-versie.
   event.waitUntil(syncRecipeImagesFromResponse(response));
  }));
 }else if(pathname.startsWith('images/')){
  event.respondWith(imageWithRefresh(event));
 }else if(pathname==='cloud-config.js'){
  // Public client configuration must refresh when the cloud backend is enabled.
  event.respondWith(networkFirst(request,CORE_CACHE));
 }else if(pathname==='voeding-cloud.js'||pathname==='pantry.js'||pathname==='manifest.webmanifest'||pathname.startsWith('icons/')){
  event.respondWith(cacheFirst(request,CORE_CACHE));
 }
});
