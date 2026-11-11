'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const origin='http://127.0.0.1:8779';
const server=spawn('python3',['-m','http.server','8779','--bind','127.0.0.1'],{stdio:'ignore'});
let browser;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(){for(let i=0;i<50;i++){try{if((await fetch(origin)).ok)return;}catch{}await pause(100);}throw Error('Testserver start niet');}
async function four(page){
 await page.locator('#plus').waitFor();
 while(Number(await page.locator('.servings strong').innerText())<4)await page.locator('#plus').click();
 assert.equal(await page.locator('.servings strong').innerText(),'4');
}
async function step(page,index){return page.locator('#recipeSteps ol > li').nth(index).innerText();}
(async()=>{
 try{
  await ready();browser=await chromium.launch();
  for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:900},locale:'nl-NL',permissions:['clipboard-read','clipboard-write']});
   await context.route('**/cloud-config.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.COOKBOOK_CLOUD_CONFIG={active:false};'}));
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'/#recept/klassieke-saucijzenbroodjes');await four(page);
   assert.match(await page.locator('#recipeIngredients').innerText(),/8 plakjes/);
   assert.match(await step(page,0),/8 plakjes/);assert.match(await step(page,4),/8 gelijke porties/);
   await page.locator('#startCooking').click();
   assert.match(await page.locator('.cook-step-body').innerText(),/8 plakjes/);
   for(let i=0;i<4;i++)await page.locator('#cookNext').click();
   assert.match(await page.locator('.cook-step-body').innerText(),/8 gelijke porties/);
   await page.locator('#cookClose').click();
   await page.locator('.recipe-more-actions summary').click();await page.locator('#copy').click();
   const copied=await page.evaluate(()=>navigator.clipboard.readText());
   assert.match(copied,/8 plakjes/);assert.match(copied,/8 gelijke porties/);
   await page.locator('[data-variant="poesta"]').click();
   assert.equal(await page.locator('.servings strong').innerText(),'4');
   assert.match(await step(page,4),/8 plakjes/);assert.match(await step(page,6),/8 gelijke porties/);
   await page.goto(origin+'/#recept/runderkofta-flatbread-knoflook-yoghurtsaus');await four(page);
   assert.match(await step(page,0),/12 gelijke porties/);assert.match(await step(page,5),/12 kofta's \(drie per persoon\)/);
   await page.goto(origin+'/#recept/chocolade-lavacake-pure-chocolade');await four(page);
   assert.match(await step(page,0),/4 ovenbestendige ramequins.*150 ml/);
   assert.match(await step(page,2),/Neem 4 eieren: gebruik 2 hele eieren/);
   await page.goto(origin+'/#recept/aperol-spritz');await four(page);
   assert.match(await step(page,2),/360 ml prosecco.*90 ml per glas/);
   assert.match(await step(page,3),/60 ml Aperol in elk glas \(240 ml in totaal\)/);
   // Reload through the actual service worker while offline.
   await page.evaluate(()=>navigator.serviceWorker.ready);
   await page.reload();await page.locator('#plus').waitFor();
   await context.setOffline(true);
   await page.goto(origin+'/#recept/klassieke-saucijzenbroodjes');await page.reload();await four(page);
   assert.match(await step(page,0),/8 plakjes/);
   assert.match(await step(page,4),/8 gelijke porties/);
   await context.setOffline(false);
   assert.deepEqual(errors,[]);
   console.log('GESLAAGD '+width+'px: ingrediënten, stappen, kookmodus, kopiëren, varianten, eieren, vaste maten en offline.');
   await context.close();
  }
 }catch(error){console.error(error);process.exitCode=1;}
 finally{if(browser)await browser.close();server.kill();}
})();
