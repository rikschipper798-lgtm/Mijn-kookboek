'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const axe=require('axe-core');
const BASE='http://127.0.0.1:8779';
const OUT='accessibility-audit-results';
fs.mkdirSync(OUT,{recursive:true});
const server=spawn('python3',['-m','http.server','8779','--bind','127.0.0.1'],{stdio:'ignore'});
const results=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
async function context(){
 const c=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block',hasTouch:false});
 await c.route('**/cloud-config.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.COOKBOOK_CLOUD_CONFIG={active:false};'}));
 const page=await c.newPage();
 await page.addScriptTag({content:axe.source}).catch(()=>{});
 return {c,page};
}
async function load(page,route){
 await page.goto(BASE+'/'+route,{waitUntil:'domcontentloaded'});
 await page.addScriptTag({content:axe.source});
}
async function scan(page,name){
 const result=await page.evaluate(async()=>{
  const output=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},rules:{'region':{enabled:true}}});
  return {
   violations:output.violations.map(v=>({
    id:v.id,impact:v.impact,description:v.help,
    nodes:v.nodes.slice(0,8).map(n=>({target:n.target,html:n.html.slice(0,300),summary:n.failureSummary?.slice(0,240)})),
    total:v.nodes.length
   })),incomplete:output.incomplete.map(v=>({id:v.id,impact:v.impact,count:v.nodes.length})),
   passes:output.passes.length
  };
 });
 const severe=result.violations.filter(v=>v.impact==='critical'||v.impact==='serious');
 console.log('AUDIT '+name+' | violations='+result.violations.length+' serious='+severe.length+
  ' | '+JSON.stringify(result.violations.map(v=>({id:v.id,impact:v.impact,n:v.total,targets:v.nodes.slice(0,3).map(n=>n.target)}))));
 results.push({type:'axe',name,...result});
 await page.screenshot({path:OUT+'/'+name+'.png'});
}
async function probe(name,fn){
 try{const detail=await fn();results.push({type:'keyboard',name,ok:true,detail});console.log('GESLAAGD | '+name+' | '+JSON.stringify(detail||{}));}
 catch(e){results.push({type:'keyboard',name,ok:false,error:e.stack});console.log('MISLUKT | '+name+' | '+e.message);}
}
(async()=>{
 try{
  for(let i=0;i<70;i++){
   try{const r=await fetch(BASE+'/index.html');if(r.ok)break;}catch(e){}
   if(i===69)throw Error('Server niet bereikbaar');await sleep(150);
  }
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const {c,page}=await context();
  try{
   await load(page,'index.html');
   await page.locator('#cards .card').first().waitFor();
   await scan(page,'receptoverzicht');
   await load(page,'index.html#recept/bruschetta');
   await page.locator('#startCooking').waitFor();
   await scan(page,'receptdetail');
   await page.locator('#startCooking').click();
   await page.locator('#cookOverlay [role=dialog]').waitFor();
   await scan(page,'kookmodus');
   await probe('Tab en Shift+Tab blijven binnen kookmodus',async()=>{
    await page.locator('#cookClose').focus();await page.keyboard.press('Shift+Tab');
    let first=await page.evaluate(()=>({id:document.activeElement.id,inside:!!document.activeElement.closest('#cookOverlay')}));
    assert.equal(first.inside,true);
    await page.keyboard.press('Tab');
    let second=await page.evaluate(()=>({id:document.activeElement.id,inside:!!document.activeElement.closest('#cookOverlay')}));
    assert.equal(second.inside,true);
    return {fromClose:first,afterTab:second};
   });
   await probe('Escape sluit kookmodus en zet focus terug',async()=>{
    await page.keyboard.press('Escape');
    await page.locator('#cookOverlay').waitFor({state:'hidden'});
    const focused=await page.evaluate(()=>document.activeElement?.id);
    assert.equal(focused,'startCooking');
    return {focus:focused};
   });
   await load(page,'index.html#recept/bruschetta');
   await page.locator('#addBasket').waitFor();
   await page.locator('#addBasket').click();
   await page.locator('#goBasket').click();
   await page.locator('#basket .basket-product-row').first().waitFor();
   await scan(page,'boodschappen');
   await page.locator('#pantryPanel>summary').click();
   await scan(page,'voorraad');
   await probe('Van receptenlijst via toetsenbord naar recept',async()=>{
    await load(page,'index.html');
    await page.locator('#cards .card').first().waitFor();
    await page.locator('#cards .card').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('#startCooking').waitFor();
    const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,visible:!!document.activeElement&&!document.activeElement.closest('[hidden]')}));
    assert.ok(focus.visible,'Focus verdween in verborgen scherm');
    return focus;
   });
   await load(page,'voeding.html');
   await page.locator('#diaryContent').waitFor({state:'visible'});
   await scan(page,'voedingsdagboek');
   await page.locator('#addMealButton').click();
   await scan(page,'maaltijdformulier');
   await probe('Maaltijdformulier openen, Escape, focusherstel',async()=>{
    await page.locator('#closeMealEntry').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#mealEntryPanel').isHidden(),true);
    const focused=await page.evaluate(()=>document.activeElement?.id);
    assert.equal(focused,'addMealButton');
    return {focus:focused};
   });
   await page.locator('#settingsMenu>summary').click();
   await scan(page,'dagboekinstellingen');
   await load(page,'instellen-vaste-maaltijden.html');
   await scan(page,'vaste-maaltijden');
   await load(page,'privacy.html');
   await scan(page,'privacy');
  }finally{await c.close();}
 }catch(e){results.push({type:'infrastructure',error:e.stack});console.log('INFRASTRUCTUUR '+e.stack);process.exitCode=2;}
 finally{
  if(browser)await browser.close();
  server.kill();
  fs.writeFileSync(OUT+'/bevindingen.json',JSON.stringify(results,null,2));
  console.log('SAMENVATTING '+JSON.stringify({axeScreens:results.filter(r=>r.type==='axe').length,
   violations:results.filter(r=>r.type==='axe').reduce((n,r)=>n+r.violations.length,0),
   serious:results.filter(r=>r.type==='axe').reduce((n,r)=>n+r.violations.filter(v=>['serious','critical'].includes(v.impact)).length,0),
   keyboardFailed:results.filter(r=>r.type==='keyboard'&&!r.ok).length}));
 }
})().catch(e=>{console.log('FOUT '+e.stack);process.exitCode=2;server.kill();});
