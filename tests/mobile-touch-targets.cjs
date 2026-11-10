'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const {chromium}=require('playwright');
const host='http://127.0.0.1:8777',output='mobile-touch-audit';
const steps=[],delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
fs.mkdirSync(output,{recursive:true});
const server=spawn('python3',['-m','http.server','8777','--bind','127.0.0.1'],{stdio:'ignore'});
let browser;
async function scan(page,label,viewport){
 const items=await page.evaluate(()=>{
  const selectors='button, a.btn, a.primary-nav-link, .pill, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), select, summary, .shop label, .basket-product-row label, .pantry-product label, .recipe-ingredient-list label';
  const nodes=[...new Set([...document.querySelectorAll(selectors)])];
  return nodes.filter(e=>{
   const s=getComputedStyle(e),r=e.getBoundingClientRect();
   return r.width>=5&&r.height>=5&&s.visibility!=='hidden'&&s.display!=='none'&&
    r.left<innerWidth&&r.right>0&&r.bottom>0&&r.top<innerHeight*12&&
    !e.closest('[hidden]')&&!e.disabled;
  }).map(e=>{
   const r=e.getBoundingClientRect();
   return {
    id:e.id||null,tag:e.tagName.toLowerCase(),
    selector:e.className&&typeof e.className==='string'?e.className.slice(0,80):'',
    text:(e.getAttribute('aria-label')||e.textContent||e.getAttribute('placeholder')||'').trim().replace(/\s+/g,' ').slice(0,55),
    w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10,
    min:Math.round(Math.min(r.width,r.height)*10)/10
   };
  });
 });
 const small=items.filter(x=>x.w<44||x.h<44);
 const scroll=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 const row={label,viewport,targets:items.length,small,scroll};
 steps.push(row);
 console.log('SCHERM '+label+' '+viewport+'px: '+items.length+' controls, '+small.length+' klein, horizontale overflow '+(scroll.scrollWidth-scroll.width));
 for(const obj of small.slice(0,30))console.log('  KLEIN '+JSON.stringify(obj));
 await page.screenshot({path:output+'/'+label+'-'+viewport+'.png',fullPage:false});
}
async function withPage(width,fn){
 const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1,locale:'nl-NL',serviceWorkers:'block'});
 await ctx.route('**/cloud-config.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.COOKBOOK_CLOUD_CONFIG={active:false};'}));
 const page=await ctx.newPage();
 try{await fn(page);}finally{await ctx.close();}
}
(async()=>{
 try{
  for(let i=0;i<50;i++){try{if((await fetch(host+'/index.html')).ok)break;}catch(error){}if(i===49)throw Error('Server niet bereikbaar');await delay(200);}
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [390,320]){
   await withPage(width,async page=>{
    await page.goto(host+'/index.html',{waitUntil:'domcontentloaded'});
    await page.locator('#cards .card').first().waitFor();
    await scan(page,'receptoverzicht',width);
    await page.goto(host+'/index.html#recept/bruschetta',{waitUntil:'domcontentloaded'});
    await page.locator('#startCooking').waitFor();
    await scan(page,'receptdetail',width);
    await page.locator('#startCooking').click();
    await page.locator('#cookOverlay').waitFor({state:'visible'});
    await scan(page,'kookmodus',width);
   });
   await withPage(width,async page=>{
    await page.goto(host+'/index.html#recept/bruschetta',{waitUntil:'domcontentloaded'});
    await page.locator('#addBasket').waitFor({state:'visible'});
    await page.locator('#addBasket').click();
    await page.locator('#goBasket').click();
    await page.locator('#basket .basket-product-row').first().waitFor();
    await scan(page,'boodschappen',width);
    await page.locator('#pantryPanel>summary').click();
    await scan(page,'voorraad',width);
   });
   await withPage(width,async page=>{
    await page.goto(host+'/voeding.html',{waitUntil:'domcontentloaded'});
    await page.locator('#diaryContent').waitFor({state:'visible'});
    await scan(page,'voedingsdagboek',width);
    const p=page.locator('#settingsMenu>summary');
    if(await p.count()){await p.click();await scan(page,'dagboekinstellingen',width);}
   });
   await withPage(width,async page=>{
    await page.goto(host+'/instellen-vaste-maaltijden.html',{waitUntil:'domcontentloaded'});
    await scan(page,'standaardmaaltijden',width);
   });
  }
 }catch(error){console.log('AUDITFOUT '+error.stack);process.exitCode=2;}
 finally{
  if(browser)await browser.close();
  server.kill();
  fs.writeFileSync(output+'/metingen.json',JSON.stringify(steps,null,2));
  console.log('AUDIT '+steps.length+' schermen, totaal '+steps.reduce((n,s)=>n+s.small.length,0)+' kleine targets');
  if(steps.length!==14)process.exitCode=2;
 }
})().catch(e=>{console.log(e.stack);process.exitCode=2;server.kill();});
