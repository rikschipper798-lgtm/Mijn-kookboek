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
 await page.waitForTimeout(350);
 const result=await page.evaluate(async()=>{
  const output=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},rules:{'region':{enabled:true}}});
  return {
   violations:output.violations.map(v=>({
    id:v.id,impact:v.impact,description:v.help,
    nodes:v.nodes.slice(0,70).map(n=>({target:n.target,html:n.html.slice(0,300),summary:n.failureSummary?.slice(0,240)})),
    total:v.nodes.length
   })),incomplete:output.incomplete.map(v=>({id:v.id,impact:v.impact,count:v.nodes.length})),
   passes:output.passes.length
  };
 });
 if(['receptoverzicht','receptdetail','boodschappen','voedingsdagboek'].includes(name)){
  for(const issue of result.violations){
   for(const n of issue.nodes)console.log('DETAIL '+name+' '+issue.id+' '+JSON.stringify({selector:n.target,summary:n.summary?.replace(/\s+/g,' ').slice(0,240)}));
  }
 }
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
   await probe('Kookmodus schermt achtergrond af voor toetsenbord en schermlezers',async()=>{
    const hidden=await page.evaluate(()=>[...document.querySelectorAll('body > nav, body > header, body > main, body > footer')].every(n=>n.inert));
    assert.equal(hidden,true);
    return {backgroundInert:true};
   });
   await probe('Escape sluit kookmodus en zet focus terug',async()=>{
    await page.keyboard.press('Escape');
    await page.locator('#cookOverlay').waitFor({state:'hidden'});
    const focused=await page.evaluate(()=>document.activeElement?.id);
    assert.equal(focused,'startCooking');
    return {focus:focused};
   });
   await probe('Kookmodus: alle stappen en afrondformulier zonder muis',async()=>{
    await page.locator('#startCooking').click();
    for(let i=0;i<20;i++){
     if(await page.locator('#finishSave').count())break;
     await page.locator('#cookNext').click();
    }
    await page.locator('#finishSave').waitFor();
    await scan(page,'kookervaring-afronden');
    await page.locator('#finishNotes').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'finishFeedback');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'finishNotes');
    const original=await page.locator('#finishNotes').inputValue();
    await page.keyboard.press('Escape');
    await page.locator('#cookOverlay').waitFor({state:'hidden'});
    const focus=await page.evaluate(()=>document.activeElement?.id);
    assert.equal(focus,'personalNotes');
    return {formKeyboard:true,original,focus};
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
    await page.locator('#cards .card a.btn').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('#startCooking').waitFor();
    await page.waitForFunction(()=>document.activeElement?.matches('.recipe-intro-main h2'));
    const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent}));
    assert.equal(focus.tag,'H2','Bij schermwissel moet de focus naar de recepttitel');
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
   // Fictieve lokale dagboekgegevens: controleer focus na DOM-hertekening.
   await page.addInitScript(()=>{
    const key='mijn-kookboek-voedingsdagboek';
    const date=new Date().toLocaleDateString('sv-SE');
    if(localStorage.getItem(key))return;
    localStorage.setItem(key,JSON.stringify({
     goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
     days:{[date]:[{id:'fixture-ontbijt',source:'preset',presetSlot:'ontbijt',confirmed:false,
      title:'Standaard ontbijt: kwark',
      nutrition:{kcal:350,proteinG:28,carbsG:43,fatG:6,fiberG:6}}]},
     weekdayPresets:{},weekdayApplied:{}
    }));
   });
   await load(page,'voeding.html');
   await page.locator('#entries [data-confirm]').first().waitFor({state:'visible'});
   await scan(page,'voorlopige-maaltijd');
   await probe('Maaltijd bevestigen behoudt focus in de lijst',async()=>{
    await page.locator('#entries [data-confirm]').first().focus();
    await page.keyboard.press('Enter');
    const focused=await page.evaluate(()=>({
     tag:document.activeElement?.tagName,
     match:document.activeElement?.matches('[data-entry-id="fixture-ontbijt"] > summary')
    }));
    assert.equal(focused.match,true);
    return focused;
   });
   await probe('Aanpassen annuleren behoudt focus bij de maaltijd',async()=>{
    await page.locator('[data-entry-id="fixture-ontbijt"] > summary').click();
    await page.locator('#entries [data-edit]').first().click();
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'editEntryName');
    await page.locator('#editEntryCancel').click();
    const match=await page.evaluate(()=>document.activeElement?.matches('[data-entry-id="fixture-ontbijt"] > summary'));
    assert.equal(match,true);
    return {focusRestored:match};
   });
   await probe('Maaltijd verwijderen zet focus op de lijstkop',async()=>{
    const row=page.locator('[data-entry-id="fixture-ontbijt"]');
    if(!await row.evaluate(node=>node.open))await row.locator('summary').click();
    await page.locator('#entries [data-remove]').first().click();
    const focused=await page.evaluate(()=>document.activeElement?.id);
    assert.equal(focused,'entryTitle');
    return {focus:focused};
   });
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
  // Geen automatische WCAG A/AA-schendingen of mislukte toetsenbordproeven
  // in de geteste pagina's en toestanden.
  if(results.filter(r=>r.type==='axe').length!==12||
     results.some(r=>r.type==='axe'&&r.violations.length)||
     results.some(r=>r.type==='keyboard'&&!r.ok))process.exitCode=1;
 }
})().catch(e=>{console.log('FOUT '+e.stack);process.exitCode=2;server.kill();});
