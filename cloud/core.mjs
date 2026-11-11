import {leaders, completedPeriods} from '../logic.mjs';

export const localDay = date => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function initialState(state={}) {
 const normalized={history:[],outbox:[],sent:[],sentIds:[],errors:{},...state};
 if(Number.isFinite(normalized.baseline))normalized.baseline=Math.trunc(normalized.baseline);
 normalized.history=normalized.history.map(reading=>({...reading,temp:Math.trunc(reading.temp)}));
 if(normalized.weather)normalized.weather={...normalized.weather,temp:Math.trunc(normalized.weather.temp)};
 return normalized;
}
export function queue(state,id,subject,text,now) {
 if(state.sentIds.includes(id)||state.outbox.some(m=>m.id===id))return;
 state.outbox.push({id,subject,text,created:now.toISOString()});
}
export function temperatureEmail(temp,history) {
 const changes=history.filter((reading,index)=>index===0||reading.temp!==history[index-1].temp);
 const lines=changes.map(reading=>{
  let time;
  if(reading.observedAt)time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'}).format(new Date(reading.observedAt)).toLowerCase();
  else{const [hour,minute]=reading.sourceTime.split('T')[1].split(':');const h=Number(hour);time=`${h%12||12}:${minute} ${h<12?'am':'pm'}`;}
  return `${time} - ${Math.trunc(reading.temp)}°`;
 });
 return `The current temperature is ${Math.trunc(temp)}°\n\n${lines.join('\n')}`;
}
export function recordWeather(state,data,now) {
 const reading=data.current?.temperature_2m;
 if(!Number.isFinite(reading)||!data.current?.time)throw Error('Weather feed has no current reading');
 const temp=Math.trunc(reading);
 const day=localDay(now);
 if(state.day!==day){state.day=day;state.baseline=null;state.history=[];}
 const sourceTime=data.current.time;
 const last=state.history.at(-1);
 if(!last||last.sourceTime!==sourceTime||last.temp!==temp)state.history.push({sourceTime,temp,observedAt:now.toISOString()});
 state.weather={temp,sourceTime,checked:now.toISOString()};
 if(state.baseline==null)state.baseline=temp;
 state.baseline=Math.trunc(state.baseline);
 if(temp!==state.baseline){
  queue(state,`weather:${day}:${sourceTime}`,`Huntington Beach: ${temp}°F`,
   temperatureEmail(temp,state.history),now);
  state.baseline=temp;
 }
 state.lastWeather=now.getTime();
}
export function recordGame(state,event,summary,now) {
 const comp=summary.header?.competitions?.[0];
 if(!comp)throw Error('Game summary not yet available');
 const status={...event.status,...comp.status,type:{...event.status?.type,...comp.status?.type}};
 const teams=comp.competitors;
 if(!Array.isArray(teams)||teams.length!==2)throw Error('Incomplete game summary');
 const gameLeaders=leaders(summary.boxscore?.players||[]);
 state.game={id:event.id,name:event.name,status:status.type?.detail||status.type?.description,
  score:teams.map(t=>`${t.team.displayName} ${t.score??'—'}`).join(' • '),leaders:gameLeaders,checked:now.toISOString()};
 const period=Number(status.period||0),finished=completedPeriods(status);
 for(let q=1;q<=finished;q++){
  const scores=teams.map(t=>{
   const lines=t.linescores||event.competitions?.[0]?.competitors?.find(e=>e.id===t.id)?.linescores||[];
   if(lines.length<q)return null;
   const values=lines.slice(0,q).map(x=>Number(x.value??x.displayValue));
   if(values.some(x=>!Number.isFinite(x)))return null;
   return `${t.team.displayName} ${values.reduce((a,b)=>a+b,0)}`;
  });
  if(scores.some(x=>x===null))continue;
  // Even during the next quarter, stats may already include new plays. Never label those as quarter-end leaders.
  const catchup=period>q;
  const label=q<=4?`quarter ${q}`:`overtime ${q-4}`;
  queue(state,`game:${event.id}:${q}`,`Lakers — end of ${label}: ${scores.join(' • ')}`,
   `Score at end of ${label}: ${scores.join(' • ')}\n\n`+
   (catchup?'Catch-up: the leaders below are current at retrieval and may include subsequent play; historical quarter-end leaders are unavailable.':'Game-to-date leaders at retrieval near the period boundary. The data provider may lag live play.')+
   `\n\n${gameLeaders.length?gameLeaders.join('\n\n'):'Player statistics are not available from the feed yet.'}\n\nRetrieved: ${now.toISOString()}\nSource: ESPN.`,now);
 }
 state.gameComplete=Boolean(status.type?.completed);
}
export async function checkFeeds(state,gameDate,now,getJson) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)||Number.isNaN(Date.parse(gameDate)))throw Error('Choose a valid game date');
 if(state.gameDate!==gameDate){state.gameDate=gameDate;state.game=null;state.gameComplete=false;state.lastGame=0;}
 if(!state.lastWeather||now.getTime()-state.lastWeather>=55000){
  try{
   const data=await getJson('https://api.open-meteo.com/v1/forecast?latitude=33.72&longitude=-118&current=temperature_2m&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles');
   recordWeather(state,data,now);delete state.errors.weather;
  }catch(e){state.errors.weather=e.message;}
 }
 if(!state.gameComplete&&(!state.lastGame||now.getTime()-state.lastGame>=14000)){
  try{
   const board=await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${gameDate.replaceAll('-','')}`);
   const event=board.events?.find(e=>e.competitions?.[0]?.competitors?.some(t=>t.team.abbreviation==='LAL'));
   if(!event){state.game={status:'No Lakers game found for this date. The feed may not be available yet.'};}
   else if(event.status?.type?.state==='pre'){
    state.game={id:event.id,name:event.name,status:event.status.type.detail,score:'Tipoff '+new Date(event.date).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' Pacific',leaders:[]};
   }else{
    const summary=await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`);
    recordGame(state,event,summary,now);
   }
   state.lastGame=now.getTime();delete state.errors.basketball;
  }catch(e){state.errors.basketball=e.message;}
 }
 state.lastCheck=now.toISOString();
 return state;
}
