'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

const HOST='http://127.0.0.1:8765';
const report=[], shots='ux-artifacts';
fs.mkdirSync(shots,{recursive:true});
const server=spawn('python3',['-m','http.server','8765','--bind','127.0.0.1'],{stdio:'ignore'});
let browser;

const waitForServer=async()=>{
 for(let i=0;i<60;i++){
  try{const r=await fetch(HOST+'/voeding.html');if(r.ok)return;}catch(e){}
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error('Lokale testwebsite is niet bereikbaar');
};
async function run(name,fn){
 const t=Date.now();
 try{
  const detail=await fn();
  console.log('GESLAAGD | '+name+(detail?' | '+JSON.stringify(detail):''));
  report.push({test:name,ok:true,detail,durationMs:Date.now()-t});
 }catch(error){
  console.log('NIET GESLAAGD | '+name+' | '+error.stack);
  report.push({test:name,ok:false,error:error.message,durationMs:Date.now()-t});
 }
}
async function newPage(mobile=false){
 const context=await browser.newContext({
  viewport:mobile?{width:390,height:844}:{width:1366,height:900},
  deviceScaleFactor:1,hasTouch:mobile,isMobile:mobile,locale:'nl-NL',timezoneId:'Europe/Amsterdam',
  acceptDownloads:true,serviceWorkers:'block'
 });
 return {context,page:await context.newPage()};
}
const goto=async(page,route='')=>page.goto(HOST+'/'+route,{waitUntil:'domcontentloaded'});
const rect=async loc=>loc.evaluate(el=>{
 const r=el.getBoundingClientRect();
 return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),bottom:Math.round(r.bottom)};
});
function localCloudConfig(page){
 return page.route('**/cloud-config.js',route=>route.fulfill({
  status:200,contentType:'application/javascript',
  body:'window.COOKBOOK_CLOUD_CONFIG={active:false};'
 }));
}

(async()=>{
 try{
  await waitForServer();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});

  await run('1. Desktop: recept vinden, starten en navigeren',async()=>{
   const {context,page}=await newPage();
   try{
    await goto(page);
    await page.locator('#search').fill('hutspot');
    const cards=page.locator('#cards .card');
    await cards.first().waitFor();
    assert.ok(await cards.count()>0,'Geen hutspot gevonden');
    await cards.first().getByRole('link',{name:/Bekijk recept/}).click();
    await page.locator('#startCooking').waitFor({state:'visible'});
    assert.ok(await page.locator('#addBasket').isVisible(),'Boodschappenknop ontbreekt');
    assert.ok(await page.locator('#recipeIngredients').isVisible(),'Ingrediënten ontbreken');
    await page.locator('#startCooking').click();
    assert.ok(await page.locator('#cookOverlay').isVisible(),'Kookmodus start niet');
    await page.screenshot({path:shots+'/desktop-kookmodus.png'});
    return {recept:await page.locator('.recipe-intro h2').first().textContent(),kookmodus:true};
   }finally{await context.close();}
  });

  await run('2. Desktop: boodschappen toevoegen, gekocht versus in huis',async()=>{
   const {context,page}=await newPage();
   try{
    await goto(page,'#recept/hutspot-rookworst-spek-gebakken-ui');
    await page.locator('#addBasket').waitFor({state:'visible'});
    await page.locator('#addBasket').click();
    await page.locator('#goBasket').click();
    await page.locator('#basket .basket-product-row').first().waitFor();
    const checkbox=page.locator('#basket [data-basket-item]').first();
    assert.ok(await checkbox.count()>0,'Geen boodschappen toegevoegd');
    await checkbox.check();
    assert.ok(await checkbox.isChecked(),'Afvinken werkt niet');
    const house=page.locator('#basket [data-house]').first();
    await house.click();
    assert.ok(await page.getByRole('button',{name:/Toch kopen/}).count()>0,'In huis markeren werkt niet');
    await page.screenshot({path:shots+'/desktop-boodschappen.png'});
    return {boodschappen:(await page.locator('#basket [data-basket-item]').count()),inHuis:true};
   }finally{await context.close();}
  });

  await run('3. Mobiel: recept, knoppen en sticky navigatie',async()=>{
   const {context,page}=await newPage(true);
   try{
    await goto(page,'#recept/hutspot-rookworst-spek-gebakken-ui');
    await page.locator('#jumpSteps').waitFor({state:'visible'});
    const primary=await rect(page.locator('.primary-nav'));
    const cook=await rect(page.locator('#startCooking'));
    const basket=await rect(page.locator('#addBasket'));
    const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,window:innerWidth}));
    assert.ok(width.scroll<=width.window+2,'Horizontale overflow op mobiele receptpagina');
    assert.ok(cook.height>=44&&basket.height>=44,'Belangrijkste knoppen zijn te klein voor touch');
    await page.locator('#jumpSteps').click();
    await page.waitForTimeout(850);
    const metrics=await page.evaluate(()=>{
     const nav=document.querySelector('.primary-nav').getBoundingClientRect();
     const jumps=document.querySelector('.recipe-jumps').getBoundingClientRect();
     const steps=document.querySelector('#recipeSteps').getBoundingClientRect();
     return {navBottom:nav.bottom,jumpsBottom:jumps.bottom,stepsTop:steps.top,stepsBottom:steps.bottom};
    });
    assert.ok(metrics.stepsTop>=Math.max(metrics.navBottom,metrics.jumpsBottom)-8,
     'Bereiding wordt gedeeltelijk door sticky navigatie afgedekt: '+JSON.stringify(metrics));
    await page.screenshot({path:shots+'/mobiel-bereiding.png',fullPage:true});
    return {nav:primary,buttons:{cook,basket},scroll:width,sticky:metrics};
   }finally{await context.close();}
  });

  await run('4. Mobiel: boodschappenlijst zonder horizontaal scrollen',async()=>{
   const {context,page}=await newPage(true);
   try{
    await goto(page,'#recept/hutspot-rookworst-spek-gebakken-ui');
    await page.locator('#addBasket').click();
    await page.locator('#goBasket').click();
    await page.locator('#basket [data-basket-item]').first().waitFor();
    const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,window:innerWidth}));
    assert.ok(dims.scroll<=dims.window+2,'Horizontale overflow op boodschappenlijst');
    const btn=page.locator('#basket [data-house]').first();
    const target=await rect(btn);
    assert.ok(target.height>=40,'Knop In huis niet bruikbaar op mobiel');
    await page.screenshot({path:shots+'/mobiel-boodschappen.png',fullPage:true});
    return {width:dims,inHuisKnop:target};
   }finally{await context.close();}
  });

  await run('5. Inloggen: gekozen recept en variant blijven behouden',async()=>{
   const {context,page}=await newPage(true);
   try{
    // Deze stub voorkomt elke verbinding met de echte persoonlijke database.
    await page.addInitScript(()=>{
     window.supabase={createClient:()=>({
      auth:{
       getSession:async()=>({data:{session:null},error:null}),
       onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
       signInWithOtp:async args=>(window.__uxSignIn=args,{data:{},error:null})
      }
     })};
    });
    await page.route('**/cloud-config.js',route=>route.fulfill({
      status:200,contentType:'application/javascript',
      body:'window.COOKBOOK_CLOUD_CONFIG={active:true,url:"https://audit.supabase.co",publishableKey:"test-key-not-a-real-secret-0123456789"};'
    }));
    await goto(page,'voeding.html?recept=hutspot-rookworst-spek-gebakken-ui&variant=klassiek');
    await page.locator('#cloudEmail').waitFor({state:'visible'});
    await page.locator('#cloudEmail').fill('controle@example.test');
    await page.locator('#cloudSignIn').click();
    await page.waitForFunction(()=>Boolean(window.__uxSignIn));
    const selected=await page.evaluate(()=>window.__uxSignIn.options.emailRedirectTo);
    const redirect=new URL(selected);
    assert.equal(redirect.searchParams.get('recept'),'hutspot-rookworst-spek-gebakken-ui',
      'De receptselectie gaat verloren in de inloglink: '+selected);
    assert.equal(redirect.searchParams.get('variant'),'klassiek','De gekozen variant gaat verloren');
    return {redirect};
   }finally{await context.close();}
  });

  await run('6. Dagboek: compacte maaltijden, automatisering en verwijderen',async()=>{
   const {context,page}=await newPage(true);
   try{
    await localCloudConfig(page);
    await page.addInitScript(()=>{
     const day=new Date().toLocaleDateString('sv-SE');
     const data={goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
      days:{[day]:[
       {id:'auto-test',source:'preset',title:'Standaard ontbijt: kwark met fruit',
        nutrition:{kcal:230,proteinG:23,carbsG:25,fatG:3,fiberG:4}},
       {id:'manual-test',source:'manual',title:'Lunch: twee boterhammen',
        nutrition:{kcal:470,proteinG:25,carbsG:55,fatG:14,fiberG:null}}
      ]},weekdayPresets:{},weekdayApplied:{}};
     localStorage.setItem('mijn-kookboek-voedingsdagboek',JSON.stringify(data));
    });
    await goto(page,'voeding.html');
    await page.locator('#entries .entry-disclosure').first().waitFor();
    assert.equal(await page.locator('#entries .entry-disclosure').count(),2);
    assert.ok(await page.locator('.entry-automatic').isVisible(),'Automatische maaltijd onvoldoende herkenbaar');
    const row=page.locator('#entries .entry-disclosure').first();
    assert.equal(await row.getAttribute('open'),null,'Details horen initieel ingeklapt te zijn');
    await row.locator('summary').click();
    assert.ok(await row.locator('.entry-details').isVisible(),'Details niet uitklapbaar');
    assert.match(await row.locator('.entry-details').textContent(),/Vezels/);
    await row.locator('[data-remove]').click();
    assert.equal(await page.locator('#entries .entry-disclosure').count(),1,'Verwijderen mislukt');
    assert.match(await page.locator('#calories').textContent(),/470/,'Dagtotaal niet bijgewerkt');
    await page.screenshot({path:shots+'/mobiel-dagboek.png',fullPage:true});
    return {compact:true,automatischLabel:true,verwijderbaar:true};
   }finally{await context.close();}
  });

  await run('7. Dagboek: back-up kan worden gedownload',async()=>{
   const {context,page}=await newPage();
   try{
    await localCloudConfig(page);
    await goto(page,'voeding.html');
    await page.locator('#settingsMenu>summary').click();
    const [download]=await Promise.all([
     page.waitForEvent('download',{timeout:10000}),
     page.locator('#export').click()
    ]);
    assert.match(download.suggestedFilename(),/^voedingsdagboek-\d{4}-\d{2}-\d{2}\.json$/);
    return {bestand:download.suggestedFilename()};
   }finally{await context.close();}
  });
 }catch(e){
  console.error('TESTINFRASTRUCTUUR FOUT:',e.stack);
  process.exitCode=2;
 }finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');
  fs.writeFileSync(shots+'/resultaten.json',JSON.stringify(report,null,2));
  console.log('\nGEBRUIKERSTEST: '+report.filter(x=>x.ok).length+'/'+report.length+' geslaagd.');
  if(report.length<7)process.exitCode=2;
 }
})().catch(error=>{console.error(error);process.exitCode=2;server.kill();});
