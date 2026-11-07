'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const workerSource=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'recepten.json'),'utf8'));
const baseUrl='https://example.test/Mijn-kookboek/';

function createWorker(recipes=catalog){
 const handlers={};
 const state={data:recipes,online:true,failImages:new Set(),requests:[]};
 const cacheMap=new Map();
 const keyFor=input=>new URL(typeof input==='string'?input:(input.url||String(input)),baseUrl).href;
 const networkFetch=async input=>{
  const uri=keyFor(input),relative=new URL(uri).pathname.replace('/Mijn-kookboek/','');
  state.requests.push(relative);
  if(!state.online)throw new Error('Geen netwerk');
  if(relative==='recepten.json'){
   return new Response(JSON.stringify(state.data),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if(relative.startsWith('images/')){
   if(state.failImages.has(relative))return new Response('Niet gevonden',{status:404});
   return new Response('foto:'+relative,{status:200});
  }
  return new Response('bestand:'+relative,{status:200});
 };
 const caches={
  async open(name){
   if(!cacheMap.has(name)){
    const items=new Map();
    cacheMap.set(name,{
     items,
     async match(input){const r=items.get(keyFor(input));return r?r.clone():undefined;},
     async put(input,response){items.set(keyFor(input),response.clone());},
     async add(input){
      const response=await networkFetch(input);
      if(!response.ok)throw new Error('HTTP '+response.status);
      await this.put(input,response);
     },
     async addAll(requests){
      for(const request of requests)await this.add(request);
     },
     async keys(){return [...items.keys()].map(url=>new Request(url));},
     async delete(input){return items.delete(keyFor(input));}
    });
   }
   return cacheMap.get(name);
  },
  async keys(){return [...cacheMap.keys()];},
  async delete(name){return cacheMap.delete(name);}
 };
 const scope={
  registration:{scope:baseUrl},
  addEventListener(name,fn){handlers[name]=fn;},
  clients:{async claim(){}},
  skipWaiting(){}
 };
 vm.runInNewContext(workerSource,{
  self:scope,caches,Request,Response,URL,fetch:networkFetch,console
 },{filename:'sw.js'});
 const dispatch=async(name,request)=>{
  const lifecycle=[];
  let responsePromise;
  const event={
   request,
   waitUntil(p){lifecycle.push(Promise.resolve(p));},
   respondWith(p){responsePromise=Promise.resolve(p);}
  };
  assert.equal(typeof handlers[name],'function','geen handler voor '+name);
  handlers[name](event);
  const response=responsePromise?await responsePromise:null;
  await Promise.all(lifecycle);
  return response;
 };
 return {
  state,caches,dispatch,
  async install(){await dispatch('install');},
  async activate(){await dispatch('activate');},
  async fetchRecipe(){return dispatch('fetch',new Request(baseUrl+'recepten.json'));},
  async fetchImage(rel){return dispatch('fetch',new Request(baseUrl+rel));},
  async cacheFor(kind){
   const key=(await caches.keys()).find(x=>x.startsWith('mijn-kookboek-pwa-'+kind+'-'));
   assert.ok(key,'ontbrekende '+kind+' cache');
   return caches.open(key);
  }
 };
}

test('Installatie slaat iedere basisfoto en alle variantfoto’s op',async()=>{
 const pwa=createWorker();
 await pwa.install();
 const cache=await pwa.cacheFor('images');
 const expected=new Set(catalog.flatMap(r=>[r.image,...(r.variants||[]).map(v=>v.image)].filter(Boolean)));
 assert.equal(expected.size,28);
 assert.equal(cache.items.size,expected.size);
 for(const filename of expected)assert.ok(await cache.match(baseUrl+filename),'niet opgeslagen: '+filename);
});

test('Nieuwe recepten en aparte variantafbeeldingen worden zonder serviceworkerupdate opgeslagen',async()=>{
 const pwa=createWorker([catalog[0]]);
 await pwa.install();
 const photos=await pwa.cacheFor('images');
 assert.equal(photos.items.size,1);
 pwa.state.data=[
  catalog[0],
  {...catalog[0],id:'voorbeeld',image:'images/voorbeeld.webp',
   variants:[{id:'anders',image:'images/voorbeeld-variant.avif'}]}
 ];
 const response=await pwa.fetchRecipe();
 assert.equal(response.status,200);
 assert.equal(photos.items.size,3);
 assert.ok(await photos.match(baseUrl+'images/voorbeeld.webp'));
 assert.ok(await photos.match(baseUrl+'images/voorbeeld-variant.avif'));
 const core=await pwa.cacheFor('core');
 const cached=await (await core.match(baseUrl+'recepten.json')).json();
 assert.equal(cached.length,2);
});

test('Ontbrekende afbeelding blokkeert installatie niet en wordt later opnieuw geprobeerd',async()=>{
 const pwa=createWorker([catalog[0]]);
 const image=catalog[0].image;
 pwa.state.failImages.add(image);
 await pwa.install();
 const photos=await pwa.cacheFor('images');
 const core=await pwa.cacheFor('core');
 assert.ok(await core.match(baseUrl+'recepten.json'));
 assert.equal(await photos.match(baseUrl+image),undefined);
 pwa.state.failImages.delete(image);
 await pwa.fetchRecipe();
 assert.ok(await photos.match(baseUrl+image));
});

test('Offline worden de vooraf opgeslagen recepten en afbeeldingen uit de cache geladen',async()=>{
 const pwa=createWorker([catalog[0]]);
 await pwa.install();
 await pwa.activate();
 pwa.state.online=false;
 const picture=await pwa.fetchImage(catalog[0].image);
 assert.equal(picture.status,200);
 assert.equal(await picture.text(),'foto:'+catalog[0].image);
 const recipes=await pwa.fetchRecipe();
 assert.equal(recipes.status,200);
 const data=await recipes.json();
 assert.equal(data.length,1);
});

test('Varianten met hetzelfde pad veroorzaken geen dubbele downloads',async()=>{
 const recipe={...catalog[0],variants:[{id:'zelfde-foto',image:catalog[0].image}]};
 const pwa=createWorker([recipe]);
 await pwa.install();
 const photos=await pwa.cacheFor('images');
 assert.equal(photos.items.size,1);
 assert.equal(pwa.state.requests.filter(p=>p===catalog[0].image).length,1);
});

test('Onveilige afbeeldingen uit JSON worden niet door de serviceworker opgevraagd',async()=>{
 const recipe={...catalog[0],image:'images/../../extern.png',
  variants:[{id:'veilig',image:'images/veilig.avif'},{id:'verkeerd',image:'https://example.test/other.png'}]};
 const pwa=createWorker([recipe]);
 await pwa.install();
 const photos=await pwa.cacheFor('images');
 assert.equal(photos.items.size,1);
 assert.ok(await photos.match(baseUrl+'images/veilig.avif'));
 assert.equal(pwa.state.requests.some(p=>p.includes('extern.png')),false);
});

test('Bij activeren worden oudere serviceworkercaches opgeruimd',async()=>{
 const pwa=createWorker([catalog[0]]);
 await pwa.caches.open('mijn-kookboek-pwa-images-oud');
 await pwa.install();
 await pwa.activate();
 assert.equal((await pwa.caches.keys()).includes('mijn-kookboek-pwa-images-oud'),false);
});
