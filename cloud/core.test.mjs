import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,recordWeather,recordGame,checkFeeds,temperatureEmail} from './core.mjs';
const time=new Date('2026-11-11T18:00:00Z');
const weather=(temp,t='2026-11-11T10:00')=>({current:{temperature_2m:temp,time:t}});
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
test('game catchup preserves quarter score, labels later leaders and does not resend accepted emails',()=>{
 const s=initialState();const e={id:'123',name:'Lakers at Bucks'};
 const summary={header:{competitions:[{status:{period:2,displayClock:'10:00',type:{detail:'2nd Quarter'}},competitors:[{id:'1',team:{displayName:'Lakers'},score:'34',linescores:[{value:30},{value:4}]},{id:'2',team:{displayName:'Bucks'},score:'29',linescores:[{value:25},{value:4}]}]}]},boxscore:{players:[]}};
 recordGame(s,e,summary,time);assert.equal(s.outbox.length,1);assert.match(s.outbox[0].subject,/Lakers 30 • Bucks 25/);assert.match(s.outbox[0].text,/Catch-up/);
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
 assert.equal(s.outbox.length,1);assert.match(s.outbox[0].subject,/Lakers 26 • Bucks 24/);
});
