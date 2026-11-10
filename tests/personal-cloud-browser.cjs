'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const port=8773,host='http://127.0.0.1:'+port,dir='persoonlijke-cloud-testresultaten';
const rows=new Map(),offline=new Set(),results=[];
fs.mkdirSync(dir,{recursive:true});
const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{stdio:'ignore'});
const copy=x=>JSON.parse(JSON.stringify(x));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser;
function rpc({table,account,device,mode,body,filters}){
 if(table!=='cookbook_personal_data')return {data:null,error:{message:'Wrong table'}};
 if(offline.has(device))return {data:null,error:{message:'Offline'}};
 const r=rows.get(account);
 if(mode==='read')return {data:r?copy(r):null,error:null};
 if(mode==='insert'){
  if(r)return {data:null,error:{message:'Duplicate'}};
  if(body.user_id!==account)return {data:null,error:{message:'RLS'}};
  rows.set(account,{data:copy(body.data),revision:body.revision});
  return {data:{revision:body.revision},error:null};
 }
 if(!r||r.revision!==filters.revision)return {data:null,error:null};
 rows.set(account,{data:copy(body.data),revision:body.revision});
 return {data:{revision:body.revision},error:null};
}
async function device(account,id,initialFavorites=[]){
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,serviceWorkers:'block',locale:'nl-NL',timezoneId:'Europe/Amsterdam'});
 await context.exposeBinding('__personalFakeDb',(_source,req)=>rpc(req));
 await context.route('**/cloud-config.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:
 'window.COOKBOOK_CLOUD_CONFIG={active:true,url:"https://test-personal.supabase.co",publishableKey:"sb_publishable_test_personal_mock_data_12345"};'}));
 await context.addInitScript(({account,id,initialFavorites})=>{
  const user={id:account,email:account+'@example.invalid'};
  if(initialFavorites.length)localStorage.setItem('mijn-kookboek-favorieten',JSON.stringify(initialFavorites));
  window.supabase={createClient:()=>({
   auth:{
    async getSession(){return {data:{session:{user}},error:null};},
    onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};}
   },
   from(table){
    let mode='read',body=null,filters={};
    return {
     select(){return this;},eq(key,value){filters[key]=value;return this;},
     insert(value){mode='insert';body=value;return this;},
     update(value){mode='update';body=value;return this;},
     async maybeSingle(){
      return window.__personalFakeDb({table,account,device:id,mode,body,filters});
     },
     async single(){return this.maybeSingle();}
    };
   }
  })};
 },{account,id,initialFavorites});
 const page=await context.newPage();
 await page.goto(host+'/index.html',{waitUntil:'domcontentloaded'});
 await page.locator('#personalCloudStatus').waitFor({state:'attached'});
 await page.locator('#personalDataPanel>summary').click();
 await page.waitForFunction(()=>!document.querySelector('#personalCloudStatus').textContent.includes('controleren'),{timeout:20000});
 return {page,context,id,account,close:()=>context.close()};
}
async function awaitRow(account,test,why){
 for(let i=0;i<110;i++){const row=rows.get(account);if(row&&test(row))return row;await sleep(100);}
 throw Error('Timeout: '+why+' '+JSON.stringify(rows.get(account)));
}
async function run(name,fn){
 const start=Date.now();
 try{const value=await fn();results.push({name,passed:true,value,ms:Date.now()-start});
  console.log('GESLAAGD | '+name+' | '+JSON.stringify(value||{}));
 }catch(e){results.push({name,passed:false,error:e.stack,ms:Date.now()-start});
  console.log('MISLUKT | '+name+' | '+e.stack);}
}
(async()=>{
 try{
  for(let i=0;i<80;i++){try{if((await fetch(host+'/index.html')).ok)break;}catch(e){}if(i===79)throw Error('Server not ready');await sleep(150);}
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  await run('1. Bestaande favorieten op eerste apparaat worden pas na keuze geüpload',async()=>{
   const a=await device('user-a','mobiel-a',['bruschetta']);
   try{
    assert.equal(rows.size,0);
    assert.equal(await a.page.locator('#personalCloudUpload').isVisible(),true);
    await a.page.evaluate(()=>{window.confirm=()=>true;});
    await a.page.locator('#personalCloudUpload').click();
    const row=await awaitRow('user-a',r=>r.revision===1,'eerste upload');
    assert.deepEqual(row.data.favorites,['bruschetta']);
    assert.equal(row.data.pantry.length,36);
    return {uploaded:true,favorites:row.data.favorites.length,pantry:row.data.pantry.length};
   }finally{await a.close();}
  });
  await run('2. Tweede apparaat kiest accountgegevens en ontvangt favorieten',async()=>{
   const a=await device('user-a','laptop-a');
   try{
    assert.equal(await a.page.evaluate(()=>favorites.has('bruschetta')),false);
    await a.page.evaluate(()=>{window.confirm=()=>true;});
    await a.page.locator('#personalCloudLoad').click();
    await a.page.waitForFunction(()=>favorites.has('bruschetta'));
    assert.equal(await a.page.locator('#personalCloudShort').textContent(),'Persoonlijke gegevens: account gekoppeld');
    return {downloaded:true};
   }finally{await a.close();}
  });
  await run('3. Voorraad, favoriet, notitie en boodschappen worden via één account bewaard',async()=>{
   const a=await device('user-a','nieuwe-mobiel');
   try{
    await a.page.evaluate(()=>window.confirm=()=>true);
    await a.page.locator('#personalCloudLoad').click();
    await a.page.waitForFunction(()=>favorites.has('bruschetta'));
    await a.page.evaluate(()=>{
     pantry.add('Havermout');
     toggleFav('hutspot-rookworst-spek-gebakken-ui');
     basket['bruschetta:klassiek']={id:'bruschetta',variantId:'klassiek',servings:2};
     save(STORAGE.basket,basket);
     personalNotes['bruschetta:klassiek']={notes:'Testnotitie op telefoon',rating:4};
     save(STORAGE.notes,personalNotes);
     cookProgress['bruschetta:klassiek']={step:2,done:false};
     save(STORAGE.cook,cookProgress);
    });
    const row=await awaitRow('user-a',r=>r.revision>=2&&r.data.notes['bruschetta:klassiek']?.rating===4,'sync all fields');
    assert.equal(row.data.pantry.some(x=>x.name==='Havermout'),true);
    assert.equal(row.data.favorites.includes('hutspot-rookworst-spek-gebakken-ui'),true);
    assert.equal(row.data.basket['bruschetta:klassiek'].servings,2);
    assert.equal(row.data.cookProgress['bruschetta:klassiek'].step,2);
    return {allSixFields:true,revision:row.revision};
   }finally{await a.close();}
  });
  await run('4. Ouder apparaat overschrijft recentere cloudversie niet',async()=>{
   const a=await device('user-a','stale-first');
   const b=await device('user-a','stale-second');
   try{
    await a.page.evaluate(()=>window.confirm=()=>true);
    await b.page.evaluate(()=>window.confirm=()=>true);
    await a.page.locator('#personalCloudLoad').click();
    await b.page.locator('#personalCloudLoad').click();
    await a.page.waitForFunction(()=>document.querySelector('#personalCloudShort')?.textContent.includes('account gekoppeld'));
    await b.page.waitForFunction(()=>document.querySelector('#personalCloudShort')?.textContent.includes('account gekoppeld'));
    const old=rows.get('user-a').revision;
    await a.page.evaluate(()=>toggleFav('hutspot-rookworst-spek-gebakken-ui'));
    await awaitRow('user-a',r=>r.revision===old+1,'first writer');
    await b.page.evaluate(()=>toggleFav('bruschetta'));
    await b.page.waitForFunction(()=>document.querySelector('#personalCloudShort')?.textContent.includes('conflict'),null,{timeout:12000});
    assert.equal(rows.get('user-a').revision,old+1);
    const key='mijn-kookboek-persoonlijk-herstel-v1:user-a';
    assert.ok(await b.page.evaluate(k=>localStorage.getItem(k),key));
    return {noSilentOverwrite:true,journalKept:true};
   }finally{await a.close();await b.close();}
  });
  await run('5. Ander account kan de gegevens van eerste account niet laden',async()=>{
   const b=await device('user-b','separate-user',['eigen-favoriet']);
   try{
    assert.equal(await b.page.locator('#personalCloudLoad').isVisible(),false);
    assert.equal(await b.page.evaluate(()=>favorites.has('bruschetta')),false);
    return {otherAccountIsolated:true};
   }finally{await b.close();}
  });
 }catch(e){console.log('TESTINFRA '+e.stack);process.exitCode=2;}
 finally{
  if(browser)await browser.close();
  server.kill();
  fs.writeFileSync(dir+'/resultaten.json',JSON.stringify(results,null,2));
  console.log('PERSOONLIJKE CLOUD BROWSER '+results.filter(x=>x.passed).length+'/'+results.length+' geslaagd');
  if(results.length!==5||results.some(x=>!x.passed))process.exitCode=1;
 }
})().catch(e=>{console.log(e.stack);process.exitCode=2;server.kill();});
