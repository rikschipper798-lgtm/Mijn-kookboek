'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const origin='http://127.0.0.1:8783',url=origin+'/_site/';
const output=path.join(root,'delen-testresultaten');
const server=spawn('python3',['-m','http.server','8783','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
const christmas='kerstmenu-18-personen-ofyr-bavette-varkenshaas';
const pastry='klassieke-saucijzenbroodjes';
let browser;
async function ready(){
 for(let i=0;i<50;i++){
  try{if((await fetch(url,{method:'HEAD'})).ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error('Testserver start niet');
}
async function context(width){
 const ctx=await browser.newContext({viewport:{width,height:900},locale:'nl-NL',permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block',reducedMotion:'reduce'});
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.fulfill({status:200,contentType:'application/javascript',body:''}));
 await ctx.route('**/cloud-config.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.COOKBOOK_CLOUD_CONFIG={active:false};'}));
 return ctx;
}
async function recipe(page,id){
 await page.goto(url+'#recept/'+id);
 await page.locator('#shareRecipe').waitFor();
 await page.waitForFunction(()=>document.querySelector('#detail').dataset.routeId===location.hash);
}
(async()=>{
 try{
  await ready();fs.mkdirSync(output,{recursive:true});
  browser=await chromium.launch(process.env.TEST_CHROMIUM_PATH?{executablePath:process.env.TEST_CHROMIUM_PATH}:{});
  for(const width of [390,1280]){
   const sender=await context(width),page=await sender.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await recipe(page,christmas);
   assert.equal(await page.locator('#shareRecipe').isVisible(),true);
   assert.equal(await page.locator('#recipeSharePanel').isVisible(),false);
   await page.locator('#shareRecipe').click();
   const christmasLink=await page.locator('#recipeShareLink').inputValue();
   assert.equal(christmasLink,url+'#recept/'+christmas+'?porties=18');
   const whatsapp=new URL(await page.locator('#whatsapp').getAttribute('href'));
   assert.equal(whatsapp.origin,'https://wa.me');
   assert.match(whatsapp.searchParams.get('text'),/Kerstdiner voor 18 personen/);
   assert.ok(whatsapp.searchParams.get('text').endsWith('\n'+christmasLink));
   assert.doesNotMatch(whatsapp.searchParams.get('text'),/Ingrediënten:|Bereiding:/);
   await page.locator('#copyRecipeLink').click();
   assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),christmasLink);
   await page.getByText('Link gekopieerd.',{exact:false}).waitFor();
   await page.screenshot({path:path.join(output,'kerstmenu-'+width+'.png'),fullPage:false});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   // Een schoon browserprofiel van de ontvanger, zonder account of opslag.
   const receiver=await context(width),opened=await receiver.newPage();
   opened.on('pageerror',error=>errors.push(error.message));
   await opened.goto(christmasLink);
   await opened.locator('#shareRecipe').waitFor();
   assert.match(await opened.locator('#detail h2').innerText(),/Kerstdiner voor 18 personen/);
   assert.equal(await opened.locator('.servings strong').innerText(),'18');
   assert.match(await opened.locator('#recipeIngredients').innerText(),/3\.000 g/);
   // Variant, hoeveelheden, herladen en lokale vervolgaanpassing.
   await recipe(page,pastry);
   await page.locator('[data-variant="poesta"]').click();
   await page.locator('#plus').click();await page.locator('#plus').click();
   await page.locator('#noteText').fill('PRIVE-NOTITIE-NIET-DELEN');
   await page.locator('#shareRecipe').click();
   await page.locator('#copyRecipeLink').click();
   const variantLink=await page.evaluate(()=>navigator.clipboard.readText());
   assert.equal(variantLink,url+'#recept/'+pastry+'?variant=poesta&porties=4');
   assert.doesNotMatch(variantLink,/PRIVE/);
   await opened.goto(variantLink);
   await opened.locator('#shareRecipe').waitFor();
   await opened.waitForFunction(()=>document.querySelector('#detail').dataset.routeId===location.hash);
   assert.equal(await opened.locator('[data-variant="poesta"]').getAttribute('aria-pressed'),'true');
   assert.equal(await opened.locator('.servings strong').innerText(),'4');
   assert.match(await opened.locator('#recipeIngredients').innerText(),/8 plakjes/);
   assert.equal(await opened.locator('#noteText').inputValue(),'');
   await opened.reload();await opened.locator('#shareRecipe').waitFor();
   assert.equal(await opened.locator('.servings strong').innerText(),'4');
   await opened.locator('#plus').click();await opened.locator('#favorite').click();
   assert.equal(await opened.locator('.servings strong').innerText(),'5');
   await opened.locator('#shareRecipe').click();
   assert.match(await opened.locator('#recipeShareLink').inputValue(),/porties=5$/);
   // Dezelfde recept-ID met andere routeparameters moet opnieuw worden toegepast.
   await opened.goto(url+'#recept/'+pastry+'?variant=klassiek&porties=2');
   await opened.waitForFunction(()=>document.querySelector('.servings strong')?.textContent==='2');
   assert.equal(await opened.locator('[data-variant="klassiek"]').getAttribute('aria-pressed'),'true');
   await opened.goBack();
   await opened.waitForFunction(()=>document.querySelector('.servings strong')?.textContent==='4');
   assert.equal(await opened.locator('[data-variant="poesta"]').getAttribute('aria-pressed'),'true');
   // Handmatig kopiëren blijft mogelijk wanneer de browser het klembord weigert.
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Geweigerd');}}}));
   await page.locator('#copyRecipeLink').click();
   assert.match(await page.locator('#recipeShareStatus').innerText(),/Kopieer de geselecteerde link/);
   assert.equal(await page.locator('#recipeShareLink').evaluate(input=>input.selectionEnd-input.selectionStart),variantLink.length);
   await page.locator('#recipeShareLink').press('Escape');
   assert.equal(await page.locator('#shareRecipe').getAttribute('aria-expanded'),'false');
   assert.equal(await page.locator('#shareRecipe').evaluate(button=>button===document.activeElement),true);
   // Native delen wordt alleen op een bewuste klik aangeroepen; annuleren is geen fout.
   await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedRecipe=data;throw new DOMException('Geannuleerd','AbortError');}}));
   await page.locator('#shareRecipe').click();
   await page.locator('#nativeShareRecipe').click();
   assert.equal((await page.evaluate(()=>window.sharedRecipe)).url,variantLink);
   assert.equal(await page.locator('#recipeShareStatus').innerText(),'');
   await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new Error('Geweigerd');}}));
   await page.locator('#nativeShareRecipe').click();
   assert.match(await page.locator('#recipeShareStatus').innerText(),/Gebruik WhatsApp of kopieer de link/);
   // Oude links en ongeldige parameters blijven bruikbaar.
   await recipe(opened,'bolognese');
   assert.equal(await opened.locator('[data-variant="romig"]').getAttribute('aria-pressed'),'true');
   await recipe(opened,'chocolade-lavacake-melkchocolade');
   assert.equal(await opened.locator('[data-variant="melkchocolade"]').getAttribute('aria-pressed'),'true');
   await recipe(opened,pastry+'?variant=onbekend&porties=-2');
   assert.equal(await opened.locator('.servings strong').innerText(),'2');
   assert.equal(await opened.locator('[data-variant="klassiek"]').getAttribute('aria-pressed'),'true');
   await opened.goto(url+'#recept/%E0%A4%A');await opened.locator('#overview').waitFor();
   await opened.goto(url+'#recept/bestaat-niet');await opened.locator('#overview').waitFor();
   assert.deepEqual(errors,[]);
   console.log('GESLAAGD '+width+'px: kerstmenu, WhatsApp-link, kopiëren, schoon ontvangerprofiel, variant, porties, historie, privacy, terugval en annuleren.');
   await sender.close();await receiver.close();
  }
 }catch(error){console.error(error);process.exitCode=1;}
 finally{if(browser)await browser.close();server.kill();}
})();
