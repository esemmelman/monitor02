import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,recordWeather,recordGame,checkFeeds,temperatureEmail,advanceGame} from './core.mjs';
const time=new Date('2026-11-11T18:00:00Z');
const weather=(temp,t='2026-11-11T10:00')=>({current:{temperature_2m:temp,time:t}});

test('completed game advances to earliest unfinished game using Pacific dates and keeps queued finals',async()=>{
 const s=initialState({gameDate:'2026-11-10',gameComplete:true,game:{id:'old'},outbox:[{id:'game:old:4'}],weatherEmailsEnabled:false,lastWeather:time.getTime()});
 const event=(id,date,completed=false)=>({id,date,name:id,competitions:[{status:{type:{completed,state:completed?'post':'pre'}}}]});
 const get=async url=>url.includes('/schedule')?{events:[event('later','2026-11-15T04:00Z'),event('old','2026-11-11T20:00Z'),event('done','2026-11-11T19:00Z',true),event('next','2026-11-12T03:00Z')]}:{events:[]};
 await checkFeeds(s,'2026-11-10',time,get);
 assert.equal(s.gameDate,'2026-11-11');assert.equal(s.game.id,'next');assert.equal(s.gameComplete,false);
 assert.deepEqual(s.outbox,[{id:'game:old:4'}]);assert.equal(s.weatherEmailsEnabled,false);
});

test('missing future schedule retries hourly without resetting the completed game',async()=>{
 const s=initialState({gameComplete:true,game:{id:'old'}});let calls=0;
 const get=async()=>{calls++;return {events:[]}};
 await advanceGame(s,time,get);await advanceGame(s,new Date(time.getTime()+60000),get);
 assert.equal(calls,1);assert.equal(s.gameComplete,true);assert.match(s.nextGameStatus,/Waiting/);
 await advanceGame(s,new Date(time.getTime()+3600000),get);assert.equal(calls,2);
});

test('in-progress game across Pacific midnight remains selected until final',async()=>{
 const s=initialState({gameDate:'2026-11-10',gameComplete:false,lastWeather:time.getTime()});
 const get=async url=>{assert(!url.includes('/schedule'));return url.includes('/summary')?{header:{competitions:[{status:{period:5,type:{state:'in',completed:false}},competitors:[{team:{displayName:'Lakers'},linescores:[]},{team:{displayName:'Suns'},linescores:[]}]}]}}:{events:[{id:'live',status:{type:{state:'in'}},competitions:[{competitors:[{team:{abbreviation:'LAL'}}]}]}]}};
 await checkFeeds(s,'2026-11-10',time,get);
 assert.equal(s.gameDate,'2026-11-10');assert.equal(s.gameComplete,false);
});

test('temperature pause drops pending weather mail and preserves Lakers mail',()=>{
 const s=initialState({weatherEmailsEnabled:false,outbox:[{id:'weather:old'},{id:'game:123:1'}]});
 recordWeather(s,weather(55),time);
 recordWeather(s,weather(56,'2026-11-11T10:15'),time);
 assert.deepEqual(s.outbox,[{id:'game:123:1'}]);
 assert.equal(s.weather.temp,56);
 assert.equal(s.weatherEmailsEnabled,false);
});
test('decimal changes are ignored, whole-number boundaries alert in either direction',()=>{
 const s=initialState();recordWeather(s,weather(55.2),time);
 recordWeather(s,weather(55.9,'2026-11-11T10:15'),time);assert.equal(s.outbox.length,0);
 recordWeather(s,weather(56.0,'2026-11-11T10:30'),time);assert.equal(s.outbox.length,1);assert.match(s.outbox[0].text,/The current temperature is 56°/);
 recordWeather(s,weather(55.9,'2026-11-11T10:45'),time);assert.equal(s.outbox.length,2);
 recordWeather(s,weather(54.9,'2026-11-11T11:00'),time);assert.equal(s.outbox.length,3);
 assert.equal(s.weather.temp,54);assert(s.history.every(x=>Number.isInteger(x.temp)));assert(s.outbox.every(x=>!/-?\d+\.\d+°F/.test(x.subject+x.text)));
});
test('existing decimal baseline and history convert without a false alert',()=>{
 const s=initialState({day:'2026-11-11',baseline:55.2,weather:{temp:55.2},history:[{sourceTime:'2026-11-11T09:45',temp:55.2}]});
 recordWeather(s,weather(55.9),time);assert.equal(s.outbox.length,0);assert.equal(s.baseline,55);assert.equal(s.history[0].temp,55);
 recordWeather(s,weather(54.9,'2026-11-11T10:15'),time);assert.equal(s.outbox.length,1);assert.match(s.outbox[0].text,/The current temperature is 54°/);
});
test('weather compares to alert baseline, includes full daily history and deduplicates retries',()=>{
 const s=initialState();recordWeather(s,weather(60),time);recordWeather(s,weather(60.5,'2026-11-11T10:15'),time);assert.equal(s.outbox.length,0);
 recordWeather(s,weather(61,'2026-11-11T10:30'),time);assert.equal(s.outbox.length,1);assert.equal(s.outbox[0].text,'The current temperature is 61°\n\n10:00 am - 60°\n10:00 am - 61°');
 recordWeather(s,weather(61,'2026-11-11T10:30'),time);assert.equal(s.outbox.length,1);assert.equal(s.history.length,3);
 recordWeather(s,weather(58,'2026-11-11T10:45'),time);assert.equal(s.outbox.length,2);
});
test('email contains only current temperature and chronological changes, including a return to an earlier temperature',()=>{
 const history=[{temp:56,observedAt:'2026-11-11T14:33:00Z'},{temp:56,observedAt:'2026-11-11T14:40:00Z'},{temp:57,observedAt:'2026-11-11T14:50:00Z'},{temp:56,observedAt:'2026-11-11T20:01:00Z'}];
 assert.equal(temperatureEmail(56,history),'The current temperature is 56°\n\n6:33 am - 56°\n6:50 am - 57°\n12:01 pm - 56°');
 assert.equal(temperatureEmail(54,[{sourceTime:'2026-11-11T00:05',temp:55},{sourceTime:'2026-11-11T13:09',temp:54}]),'The current temperature is 54°\n\n12:05 am - 55°\n1:09 pm - 54°');
});
test('Pacific midnight clears history and sets a new baseline without a false alert',()=>{
 const s=initialState();recordWeather(s,weather(60,'2026-11-11T23:45'),new Date('2026-11-12T07:45:00Z'));
 recordWeather(s,weather(55,'2026-11-12T00:00'),new Date('2026-11-12T08:00:00Z'));
 assert.equal(s.history.length,1);assert.equal(s.baseline,55);assert.equal(s.outbox.length,0);
});
test('game catchup preserves quarter score, formats the lead and does not resend accepted emails',()=>{
 const s=initialState();const e={id:'123',name:'Lakers at Bucks'};
 const summary={header:{competitions:[{status:{period:2,displayClock:'10:00',type:{detail:'2nd Quarter'}},competitors:[{id:'1',team:{displayName:'Lakers'},score:'34',linescores:[{value:30},{value:4}]},{id:'2',team:{displayName:'Bucks'},score:'29',linescores:[{value:25},{value:4}]}]}]},boxscore:{players:[]}};
 recordGame(s,e,summary,time);assert.equal(s.outbox.length,1);assert.equal(s.outbox[0].subject,'1st Quarter - Lakers 30 - Bucks 25');assert.match(s.outbox[0].text,/^The Lakers are up by 5 points[.]/);
 s.sentIds.push(s.outbox[0].id);s.outbox=[];recordGame(s,e,summary,time);assert.equal(s.outbox.length,0);
});
test('feed failures stay independent and successful weather checks are throttled',async()=>{
 const s=initialState();let weatherCalls=0;const get=async url=>{if(url.includes('meteo')){weatherCalls++;return weather(60)}throw Error('Basketball unavailable')};
 await checkFeeds(s,'2026-11-11',time,get);assert.equal(s.weather.temp,60);assert.match(s.errors.basketball,/unavailable/);
 await checkFeeds(s,'2026-11-11',new Date(time.getTime()+15000),get);assert.equal(weatherCalls,1);
});
test('scoreboard period is retained when summary provides only status type',()=>{
 const s=initialState();const event={id:'456',status:{period:1,displayClock:'0:00',type:{detail:'End of 1st'}},competitions:[{competitors:[{id:'1',linescores:[{value:26}]},{id:'2',linescores:[{value:24}]}]}]};
 recordGame(s,event,{header:{competitions:[{status:{type:{detail:'End of 1st'}},competitors:[{id:'1',team:{displayName:'Lakers'},score:'26'},{id:'2',team:{displayName:'Bucks'},score:'24'}]}]},boxscore:{players:[]}},time);
 assert.equal(s.outbox.length,1);assert.match(s.outbox[0].subject,/Lakers 26 - Bucks 24/);
});

test('emails put Lakers first for deficits, ties, every quarter and overtime',()=>{
 for(const [q,label] of [[1,'1st Quarter'],[2,'2nd Quarter'],[3,'3rd Quarter'],[4,'4th Quarter'],[5,'Overtime 1']]){
  for(const [score,opening] of [[24,'The Lakers are down by 1 point.'],[25,'The Lakers are tied.'],[27,'The Lakers are up by 2 points.']]){
   const s=initialState();
   recordGame(s,{id:'format'},{header:{competitions:[{status:{period:q,type:{completed:true}},competitors:[
    {id:'mil',team:{displayName:'Milwaukee Bucks'},linescores:Array.from({length:q},()=>({value:25}))},
    {id:'lal',team:{abbreviation:'LAL',displayName:'Los Angeles Lakers'},linescores:Array.from({length:q},(_,i)=>({value:i===0?score:25}))}
   ]}]},boxscore:{players:[]}},time);
   const email=s.outbox.at(-1);
   assert.equal(email.subject,`${label} - Lakers ${score+25*(q-1)} - Milwaukee Bucks ${25*q}`);
   assert.equal(email.text,`${opening}\n\nPlayer statistics are not available from the feed yet.`);
  }
 }
});
