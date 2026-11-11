import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {initialState,checkFeeds,queue} from './core.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const recipient='esemmoc@gmail.com';
const allowedOrigins=new Set(['https://esemmelman.github.io','http://127.0.0.1:8787','http://localhost:8787']);
const cors={'Access-Control-Allow-Origin':'https://esemmelman.github.io','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, GET, OPTIONS','Vary':'Origin'};
const emailConfigured=()=>Boolean(Deno.env.get('RESEND_API_KEY')&&Deno.env.get('REMINDER_EMAIL_FROM'));
async function getJson(url:string){
 const options={headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'},signal:AbortSignal.timeout(10000)};
 let response=await fetch(url,options);
 if(!response.ok&&url.startsWith('https://site.api.espn.com/'))response=await fetch(url.replace('site.api.espn.com','site.web.api.espn.com'),{...options,signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error(`Data feed returned ${response.status}`);return response.json();
}

Deno.serve(async(request:Request)=>{
 const origin=request.headers.get('origin');
 const headers={...cors,...(origin&&allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
 if(origin&&!allowedOrigins.has(origin))return reply({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method==='GET')return reply({service:'monitor02',emailConfigured:emailConfigured(),mode:'scheduled-every-minute'});
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const {data:schedule,error:scheduleError}=await db.from('monitor02_schedule').select('*').eq('id',true).single();
 if(scheduleError)return reply({error:'Background schedule is not configured'},503);
 const cronToken=request.headers.get('x-monitor-secret');
 let isCron=false;
 if(cronToken){
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cronToken)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  isCron=digest===schedule.secret_hash;
  if(!isCron)return reply({error:'Invalid scheduler credential'},401);
 }else{
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return reply({error:'Sign in with your DayFlow account'},401);
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth.user)return reply({error:'Your session expired. Sign in again.'},401);
  if(auth.user.id!==schedule.user_id||auth.user.email?.toLowerCase()!==recipient||!auth.user.email_confirmed_at)return reply({error:'This personal monitor is restricted to its owner.'},403);
 }
 const owner=schedule.user_id;
 const publicSchedule=()=>({enabled:schedule.enabled,gameDate:schedule.game_date,intervalSeconds:60});
 let locked=false;
 let state:any;
 try{
  const body=await request.json();
  if(isCron?body.action!=='cron':!['status','configure','test'].includes(body.action))return reply({error:'Unknown action'},400);
  if(body.action==='configure'){
   if(typeof body.enabled!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(body.gameDate||'')||Number.isNaN(Date.parse(body.gameDate)))return reply({error:'Invalid schedule settings'},400);
   const {error}=await db.from('monitor02_schedule').update({enabled:body.enabled,game_date:body.gameDate}).eq('id',true);
   if(error)throw Error('Unable to save background settings');
   schedule.enabled=body.enabled;schedule.game_date=body.gameDate;
  }
  const {error:insertError}=await db.from('monitor02_state').upsert({user_id:owner},{onConflict:'user_id',ignoreDuplicates:true});
  if(insertError)throw Error('Unable to initialize monitor state');
  if(body.action==='status'||body.action==='configure'){
   const {data,error}=await db.from('monitor02_state').select('state').eq('user_id',owner).single();
   if(error)throw Error('Unable to read monitor state');
   return reply({state:initialState(data.state),schedule:publicSchedule(),emailConfigured:emailConfigured()});
  }
  if(isCron&&!schedule.enabled)return reply({paused:true});
  if(!emailConfigured())return reply({error:'The DayFlow email service is missing its sender configuration.'},503);
  const now=new Date();
  const {data:row,error:lockError}=await db.from('monitor02_state').update({lease_until:new Date(now.getTime()+120000).toISOString()}).eq('user_id',owner).lt('lease_until',now.toISOString()).select('state').maybeSingle();
  if(lockError)throw Error('Unable to acquire monitor lock');
  if(!row)return reply({busy:true});
  locked=true;state=initialState(row.state);
  async function persist(){const {error}=await db.from('monitor02_state').update({state,updated_at:new Date().toISOString()}).eq('user_id',owner);if(error)throw Error('Unable to save monitor state');}
  if(body.action==='test'){
   if(state.lastTest&&now.getTime()-state.lastTest<60000)return reply({error:'Wait one minute before sending another test.'},429);
   state.lastTest=now.getTime();
   queue(state,`test:${now.getTime()}`,'Monitor02 email test','Your weather and Lakers monitor is connected to the same email service as DayFlow. Background checks run every minute while enabled, even when the page is closed or your computer is off. Use the dashboard to pause background monitoring.',now);
  }else{
   if(state.lastTick&&now.getTime()-state.lastTick<10000)return reply({state,schedule:publicSchedule(),emailConfigured:true});
   state.lastTick=now.getTime();
   await checkFeeds(state,String(schedule.game_date),now,getJson);
   queue(state,'background-enabled-v1','Monitor02 background monitoring is enabled',`Weather alerts for Huntington Beach 92647 are now enabled. Checks run about once a minute, even with the webpage closed and your computer off.\n\nAlerts go to ${recipient} for changes of at least 1°F and include the day's readings recorded so far. Lakers quarter and overtime score alerts are enabled for ${schedule.game_date}, with both teams' points, rebounds and assists leaders.\n\nDashboard and pause control: https://esemmelman.github.io/monitor02/\n\nCurrent temperature: ${state.weather?.temp??'awaiting weather feed'}°F.`,now);
  }
  // Save exact email payloads before sending, so retries use the same Resend idempotency key and content.
  await persist();
  for(const email of state.outbox.slice(0,2)){
   try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${Deno.env.get('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`monitor02:${owner}:${email.id}`},body:JSON.stringify({from:Deno.env.get('REMINDER_EMAIL_FROM'),to:[recipient],subject:email.subject,text:email.text})});
    if(!response.ok){const details=await response.json().catch(()=>({}));throw Error(`Email provider ${response.status}: ${details.message||'delivery failed'}`);}
    const result=await response.json();
    state.sent.unshift({id:email.id,subject:email.subject,time:new Date().toISOString(),providerId:result.id});
    state.sent=state.sent.slice(0,100);state.sentIds.push(email.id);state.sentIds=state.sentIds.slice(-10000);
    state.outbox=state.outbox.filter((m:any)=>m.id!==email.id);delete state.errors.email;
    await persist();
   }catch(e){state.errors.email=(e as Error).message;await persist();break;}
  }
  return reply({state,schedule:publicSchedule(),emailConfigured:true});
 }catch(e){return reply({error:(e as Error).message||'Unable to check monitor'},500);}
 finally{if(locked)await db.from('monitor02_state').update({lease_until:'1970-01-01T00:00:00Z'}).eq('user_id',owner);}
});
