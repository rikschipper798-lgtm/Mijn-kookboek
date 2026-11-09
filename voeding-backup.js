/* Portable encrypted diary backups. No key or passphrase is stored. */
(function(){
 'use strict';
 const FORMAT='mijn-kookboek-versleuteld-dagboek';
 const ITERATIONS=310000;
 const encode=s=>new TextEncoder().encode(s);
 const decode=a=>new TextDecoder().decode(a);
 const binTo64=bytes=>{
  let chunks=[];
  for(let i=0;i<bytes.length;i+=8192){
   const part=bytes.subarray(i,i+8192);
   let s='';for(const b of part)s+=String.fromCharCode(b);
   chunks.push(s);
  }
  return btoa(chunks.join(''));
 };
 const from64=s=>{
  if(typeof s!=='string'||s.length>8*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('Ongeldige back-upcodering.');
  const b=atob(s),a=new Uint8Array(b.length);
  for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
  return a;
 };
 function checkCrypto(){
  if(!window.crypto||!window.crypto.subtle||!window.crypto.getRandomValues)
   throw Error('Deze browser ondersteunt geen beveiligde back-up. Gebruik een actuele browser via HTTPS.');
 }
 async function keyFor(password,salt,iterations){
  const material=await window.crypto.subtle.importKey('raw',encode(password),'PBKDF2',false,['deriveKey']);
  return window.crypto.subtle.deriveKey(
   {name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,
   {name:'AES-GCM',length:256},false,['encrypt','decrypt']
  );
 }
 async function encrypt(payload,password){
  checkCrypto();
  if(typeof password!=='string'||password.length<12)
   throw Error('Gebruik een eigen wachtzin van minstens 12 tekens.');
  const bytes=encode(JSON.stringify(payload));
  if(bytes.byteLength>2*1024*1024)throw Error('Dagboek is te groot om in één bestand te exporteren.');
  const salt=window.crypto.getRandomValues(new Uint8Array(16));
  const iv=window.crypto.getRandomValues(new Uint8Array(12));
  const key=await keyFor(password,salt,ITERATIONS);
  const aad=encode(FORMAT+':1');
  const cipher=await window.crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,bytes);
  return {app:FORMAT,version:1,algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA256',
   iterations:ITERATIONS,salt:binTo64(salt),iv:binTo64(iv),ciphertext:binTo64(new Uint8Array(cipher))};
 }
 function isEncrypted(payload){return !!payload&&payload.app===FORMAT;}
 async function decrypt(payload,password){
  checkCrypto();
  if(!isEncrypted(payload)||payload.version!==1||payload.algorithm!=='AES-256-GCM'||
     payload.kdf!=='PBKDF2-SHA256'||payload.iterations!==ITERATIONS)
    throw Error('Dit is geen ondersteund versleuteld dagboek.');
  if(typeof password!=='string'||!password)throw Error('Vul de wachtzin in.');
  const salt=from64(payload.salt),iv=from64(payload.iv),cipher=from64(payload.ciphertext);
  if(salt.length!==16||iv.length!==12||cipher.length<16||cipher.length>3*1024*1024)
   throw Error('Het back-upbestand is beschadigd of onjuist.');
  const key=await keyFor(password,salt,ITERATIONS);
  let content;
  try{
   content=await window.crypto.subtle.decrypt(
    {name:'AES-GCM',iv,additionalData:encode(FORMAT+':1')},key,cipher
   );
  }catch(error){throw Error('Ontsleutelen mislukt. Controleer de wachtzin of het back-upbestand.');}
  try{return JSON.parse(decode(content));}
  catch(error){throw Error('De ontsleutelde back-up is ongeldig.');}
 }
 window.CookbookBackup={encrypt,decrypt,isEncrypted};
})();
