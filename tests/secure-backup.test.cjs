'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../voeding-backup.js'),'utf8');
function instance(){
 const w={crypto:webcrypto};
 vm.runInNewContext(source,{window:w,TextEncoder,TextDecoder,btoa,atob,Uint8Array,JSON,Error,String},{timeout:1000});
 return w.CookbookBackup;
}
const diary={app:'mijn-kookboek-voedingsdagboek',version:1,exportedAt:'2026-11-09T12:00:00Z',
 data:{goals:{kcal:2300,proteinG:160,carbsG:246,fatG:75,fiberG:37.5},
  days:{'2026-11-09':[{id:'one',source:'manual',title:'Mijn lunch',
    nutrition:{kcal:500,proteinG:20,carbsG:60,fatG:15,fiberG:10}}]},
  weekdayPresets:{},weekdayApplied:{}}};
test('Versleutelde back-up roundtrip levert identiek dagboek terug',async()=>{
 const backup=instance();
 const encrypted=await backup.encrypt(diary,'Een zeer lange voorbeeldwachtzin 123');
 assert.equal(encrypted.app,'mijn-kookboek-versleuteld-dagboek');
 assert.equal(encrypted.algorithm,'AES-256-GCM');
 assert.equal(encrypted.kdf,'PBKDF2-SHA256');
 assert.equal(encrypted.iterations,310000);
 assert.equal(JSON.stringify(encrypted).includes('Mijn lunch'),false);
 const recovered=await backup.decrypt(encrypted,'Een zeer lange voorbeeldwachtzin 123');
 assert.deepEqual(JSON.parse(JSON.stringify(recovered)),diary);
});
test('Verkeerde wachtzin kan de back-up niet ontsleutelen',async()=>{
 const backup=instance();
 const encrypted=await backup.encrypt(diary,'Een zeer lange voorbeeldwachtzin 123');
 await assert.rejects(()=>backup.decrypt(encrypted,'Volledig verkeerde wachtzin'),/Ontsleutelen mislukt/);
});
test('Beschadigd bestand wordt afgewezen',async()=>{
 const backup=instance();
 const encrypted=await backup.encrypt(diary,'Een zeer lange voorbeeldwachtzin 123');
 const altered={...encrypted,ciphertext:encrypted.ciphertext.slice(0,-8)+'AAAAAA=='};
 await assert.rejects(()=>backup.decrypt(altered,'Een zeer lange voorbeeldwachtzin 123'),/Ongeldige back-upcodering|Ontsleutelen mislukt|beschadigd/);
});
test('Te korte wachtzinnen worden afgewezen',async()=>{
 const backup=instance();
 await assert.rejects(()=>backup.encrypt(diary,'kort'),/minstens 12 tekens/);
});
test('Ieder bestand gebruikt nieuw salt en IV',async()=>{
 const backup=instance();
 const one=await backup.encrypt(diary,'Een zeer lange voorbeeldwachtzin 123');
 const two=await backup.encrypt(diary,'Een zeer lange voorbeeldwachtzin 123');
 assert.notEqual(one.salt,two.salt);
 assert.notEqual(one.iv,two.iv);
 assert.notEqual(one.ciphertext,two.ciphertext);
});
test('Dagboekpagina bevat beide veilige routes en blijft compatibel met JSON-import',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../voeding.html'),'utf8');
 assert.match(html,/voeding-backup\.js/);
 assert.match(html,/id="backupEncrypted"/);
 assert.match(html,/id="backupDecrypt"/);
 assert.match(html,/if\(window\.CookbookBackup\.isEncrypted\(payload\)\)/);
 assert.match(html,/if\(payload\.app!=='mijn-kookboek-voedingsdagboek'/);
 assert.match(html,/if\(!commit\(\(\)=>\{state=imported;\}\)\)/);
});
