import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { leaders, completedPeriods } from './logic.mjs';
fs.mkdirSync('private',{recursive:true});
const read=(n,d)=>{try{return JSON.parse(fs.readFileSync(`private/${n}.json`))}catch{return d}};
const save=(n,v)=>{fs.writeFileSync(`private/${n}.tmp`,JSON.stringify(v));fs.renameSync(`private/${n}.tmp`,`private/${n}.json`)};
let config=read('config',{location:'Huntington Beach, CA 92647',latitude:33.72,longitude:-118.00,timezone:'America/Los_Angeles',unit:'fahrenheit',recipient:'',host:'smtp.gmail.com',port:465,user:'',password:'',enabled:false,gameDate:'2026-11-11'});
let state=read('state',{history:[],outbox:[],sent:[],game:null,errors:{}});
const token=crypto.randomBytes(24).toString('hex');
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Feed returned ${r.status}`);return r.json()}
function enqueue(id,subject,text){if(!state.sent.some(x=>x.id===id)&&!state.outbox.some(x=>x.id===id))state.outbox.push({id,subject,text,created:new Date().toISOString()})}
async function weather(){
 const d=await json(`https://api.open-meteo.com/v1/forecast?latitude=${config.latitude}&longitude=${config.longitude}&current=temperature_2m&temperature_unit=${config.unit}&timezone=auto`);
 const temp=d.current?.temperature_2m;if(!Number.isFinite(temp))throw Error('Weather feed has no temperature');
 const date=day();if(state.day!==date){state.day=date;state.baseline=null;state.history=[]}
 if(!state.history.some(x=>x.sourceTime===d.current.time))state.history.push({time:new Date().toISOString(),sourceTime:d.current.time,temp});
 state.weather={temp,unit:config.unit,checked:new Date().toISOString()};
 if(state.baseline===null||state.baseline===undefined)state.baseline=temp;
 if(Math.abs(temp-state.baseline)>=1){
  const unit=config.unit==='fahrenheit'?'F':'C';
  enqueue(`weather:${date}:${d.current.time}`,`${config.location}: ${temp}°${unit}`,`Temperature moved at least 1°${unit} from ${state.baseline}°${unit}.\n${config.location} — ${date}\nRecorded readings since monitoring began today (Open-Meteo model estimates):\n\n`+state.history.map(x=>`${x.sourceTime}: ${x.temp}°${unit}`).join('\n'));
  state.baseline=temp;
 }
}
async function basketball(){
 const board=await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${config.gameDate.replaceAll('-','')}`);
 const event=board.events?.find(e=>e.competitions?.[0]?.competitors?.some(t=>t.team.abbreviation==='LAL'));
 if(!event){state.game={message:'No Lakers game found for selected date. Feed may not be available yet.'};return}
 const s=await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`);
 const c=s.header?.competitions?.[0];if(!c)throw Error('Game feed unavailable');
 const status=c.status||event.status;const teams=c.competitors;
 const period=Number(status.period||0);const completed=completedPeriods(status);
 const score=teams.map(t=>`${t.team.displayName} ${t.score}`).join(' • ');
 state.game={id:event.id,message:status.type?.detail||status.type?.description,score,leaders:leaders(s.boxscore?.players||[]),checked:new Date().toISOString()};
 for(let q=1;q<=completed;q++){
  const id=`game:${event.id}:${q}`;if(state.sent.some(x=>x.id===id)||state.outbox.some(x=>x.id===id))continue;
  const scores=teams.map(t=>{const lines=t.linescores||[];if(lines.length<q)return null;return `${t.team.displayName} ${lines.slice(0,q).reduce((a,b)=>a+Number(b.value??b.displayValue),0)}`});
  if(scores.some(x=>x===null))continue;
  const late=period>q+1||(period===q+1&&Number(status.displayClock?.split(':')[0])<11);
  enqueue(id,`Lakers: ${q<=4?'end of quarter '+q:'end of overtime '+(q-4)} — ${scores.join(' • ')}`,`Score at end of period ${q}: ${scores.join(' • ')}\n\n${late?'Delayed catch-up: leaders below are current when retrieved, not historical quarter-end leaders.':'Game-to-date leaders at retrieval (feed updates may lag quarter end).'}\n\n${state.game.leaders.join('\n\n')}\n\nRetrieved ${new Date().toISOString()}\nSource: ESPN. Public feed availability is not guaranteed.`);
 }
}
async function deliver(){
 if(!config.recipient||!config.user||!config.password)throw Error('Complete recipient and SMTP settings to enable delivery');
 const transport=nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:config.port!==465,auth:{user:config.user,pass:config.password},connectionTimeout:15000,socketTimeout:20000});
 for(const m of [...state.outbox]){await transport.sendMail({from:config.user,to:config.recipient,subject:m.subject,text:m.text});state.sent.unshift({id:m.id,subject:m.subject,time:new Date().toISOString()});state.sent=state.sent.slice(0,300);state.outbox=state.outbox.filter(x=>x.id!==m.id);save('state',state)}
}
let busy=false,lastWeather=0;
async function tick(){if(busy||!config.enabled)return;busy=true;try{
 for(const [name,fn] of [['weather',async()=>{if(Date.now()-lastWeather>60000){await weather();lastWeather=Date.now()}}],['basketball',basketball],['email',deliver]]){try{await fn();delete state.errors[name]}catch(e){state.errors[name]=e.message}}
 state.lastCheck=new Date().toISOString();save('state',state);
}finally{busy=false}}
setInterval(tick,15000);tick();
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
 if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html');res.end(fs.readFileSync('index.html','utf8').replace('__TOKEN__',token));return}
 if(req.method==='GET'&&req.url==='/api/status'){const {password,...safe}=config;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({config:{...safe,passwordSet:!!password},state}));return}
 if(req.method!=='POST'||req.headers['x-monitor-token']!==token){res.writeHead(403);res.end('Forbidden');return}
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)throw Error('Request too large')}
 const body=JSON.parse(raw||'{}');
 if(req.url==='/api/config'){
 if(busy)throw Error('Check in progress; try again in a few seconds');
 const next={...config,...Object.fromEntries(Object.entries(body).filter(([k])=>Object.keys(config).includes(k)))};if(!body.password)next.password=config.password;
 if(!['fahrenheit','celsius'].includes(next.unit)||!Number.isFinite(+next.latitude)||Math.abs(+next.latitude)>90||!Number.isFinite(+next.longitude)||Math.abs(+next.longitude)>180)throw Error('Invalid coordinates or unit');
 new Intl.DateTimeFormat('en',{timeZone:next.timezone});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(next.gameDate))throw Error('Invalid game date');
 if(next.enabled&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.recipient)||!next.user||!next.password||!next.host))throw Error('Recipient and complete SMTP settings required');
 next.port=+next.port;if(!Number.isInteger(next.port)||next.port<1||next.port>65535)throw Error('Invalid SMTP port');
 if(['latitude','longitude','unit','timezone'].some(k=>next[k]!==config[k])){state.history=[];state.baseline=null;state.day=null}
 config=next;save('config',config);lastWeather=0;setTimeout(tick,0);
 }else if(req.url==='/api/test'){
 const t=nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:config.port!==465,auth:{user:config.user,pass:config.password}});
 await t.sendMail({from:config.user,to:config.recipient,subject:'Monitor01 test email',text:'Your weather and Lakers monitor can send email. Enable monitoring in the dashboard.'});
 }else throw Error('Unknown action');
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}))}
});
server.listen(8787,'127.0.0.1',()=>console.log('Monitor dashboard: http://127.0.0.1:8787'));
