'use strict';
// Bestandsversie: verhoog deze waarde bij wijzigingen aan offline infrastructuur.
// index.html en recepten.json worden online altijd opnieuw opgehaald.
const CACHE_VERSION='2026-11-01-pwa-brand-v2';
const CORE_CACHE='mijn-kookboek-pwa-core-'+CACHE_VERSION;
const IMAGE_CACHE='mijn-kookboek-pwa-images-'+CACHE_VERSION;
const CACHE_PREFIX='mijn-kookboek-pwa-';
const SCOPE=self.registration.scope;
const ROOT=new URL('./',SCOPE);
const CORE_ASSETS=['index.html','recepten.json','manifest.webmanifest',
 'icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png'];
// Receptafbeeldingen van de huidige collectie; toekomstige afbeeldingen worden
// bij online gebruik ook automatisch opgeslagen door de fetch-handler.
const IMAGE_ASSETS=[
 "images/broodje-crispy-kipschnitzel-sriracha-mayo.webp",
 "images/gekruide-kipschnitzel.webp",
 "images/pasta-rundergehakt-groenten.webp",
 "images/bolognese.webp",
 "images/gnocchi.webp",
 "images/piripiri.webp",
 "images/bruschetta.webp",
 "images/gyros.webp",
 "images/goulash.webp",
 "images/arayes.webp",
 "images/hamburgers.webp",
 "images/shawarma.webp",
 "images/kiprijst.webp",
 "images/traybake.webp",
 "images/varkenshaas.webp",
 "images/vlaams-stoofvlees.webp",
 "images/zalm.webp",
 "images/stokbrood.webp",
 "images/kipwraps.webp",
 "images/chocolademelk.webp",
 "images/kruidenboter.webp",
 "images/kip-satesaus.webp",
 "images/mexicaanse-kipwraps.webp",
 "images/italiaanse-pesto-salamipizza-flatbread.webp"
];

self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  // Zonder volledig basisscherm en recepten activeren we niet als offline app.
  const core=await caches.open(CORE_CACHE);
  await core.addAll(CORE_ASSETS.map(path=>new Request(new URL(path,ROOT),{cache:'reload'})));
  // Afbeeldingen zijn aanvullend: een ontbrekende foto blokkeert de app niet.
  const photos=await caches.open(IMAGE_CACHE);
  await Promise.allSettled(IMAGE_ASSETS.map(path=>
   photos.add(new Request(new URL(path,ROOT),{cache:'reload'}))));
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
async function networkFirst(request,cacheName,fallbackUrl=null){
 const cache=await caches.open(cacheName);
 try{
  const response=await fetch(request);
  if(response.ok){
   try{await cache.put(request,response.clone())}catch(e){}
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
  event.respondWith(networkFirst(request,CORE_CACHE,new URL('index.html',ROOT)));
 }else if(pathname==='recepten.json'){
  event.respondWith(networkFirst(request,CORE_CACHE));
 }else if(pathname.startsWith('images/')){
  event.respondWith(imageWithRefresh(event));
 }else if(pathname==='manifest.webmanifest'||pathname.startsWith('icons/')){
  event.respondWith(cacheFirst(request,CORE_CACHE));
 }
});
