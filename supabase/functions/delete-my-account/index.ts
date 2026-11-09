// Persoonlijke accountverwijdering voor Mijn Kookboek.
// Gevoelige sleutel uitsluitend op de Supabase Edge Function-server.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const origin="https://rikschipper798-lgtm.github.io";
const cors={
  "Access-Control-Allow-Origin":origin,
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Vary":"Origin",
};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
});

Deno.serve(async(request:Request)=>{
 const requestingOrigin=request.headers.get("origin");
 if(requestingOrigin && requestingOrigin!==origin)return reply({error:"Origin niet toegestaan"},403);
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(request.method!=="POST")return reply({error:"Alleen POST is toegestaan"},405);
 const auth=request.headers.get("authorization")||"";
 if(!/^Bearer\s+\S+$/i.test(auth))return reply({error:"Log eerst in"},401);
 let body:Record<string,unknown>;
 try{body=await request.json();}
 catch{return reply({error:"Ongeldige invoer"},400);}
 if(body?.confirmation!=="VERWIJDER")return reply({error:"Bevestiging ontbreekt"},400);
 try{
  const url=Deno.env.get("SUPABASE_URL");
  const anon=Deno.env.get("SUPABASE_ANON_KEY");
  const adminKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!adminKey)return reply({error:"Serverconfiguratie ontbreekt"},500);
  const verifier=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=auth.replace(/^Bearer\s+/i,"");
  const {data,error}=await verifier.auth.getUser(token);
  if(error||!data.user)return reply({error:"Ongeldige of verlopen inlogsessie"},401);
  const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const deleted=await admin.auth.admin.deleteUser(data.user.id);
  if(deleted.error){
   console.error("Account verwijderen mislukt",deleted.error.code||"unknown");
   return reply({error:"Account verwijderen is niet gelukt"},500);
  }
  // public.nutrition_diaries verwijst naar auth.users ON DELETE CASCADE.
  return reply({deleted:true});
 }catch(err){
  console.error("Accountverwijdering intern mislukt");
  return reply({error:"Er is een technische fout opgetreden"},500);
 }
});
