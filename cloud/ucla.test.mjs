import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,queue} from './core.mjs';
import {checkUcla} from './ucla.mjs';
const now=new Date('2026-11-14T03:00:00Z');
const feed=(a,b,completed=false)=>async()=>({header:{competitions:[{status:{type:{detail:completed?'Final':'2nd Quarter',completed}},competitors:[{team:{abbreviation:'ILL',displayName:'Illinois Fighting Illini'},score:String(b)},{team:{abbreviation:'UCLA',displayName:'UCLA Bruins'},score:String(a)}]}]}});
test('UCLA baseline, changes for either team, repeated scores and corrections',async()=>{
 const s=initialState({weatherEmailsEnabled:false});
 for(const [a,b] of [[7,7],[7,7],[14,7],[14,10],[14,7],[14,10]])await checkUcla(s,now,feed(a,b),queue);
 assert.equal(s.outbox.length,4);
 assert.equal(new Set(s.outbox.map(m=>m.id)).size,4);
 assert.equal(s.outbox[0].subject,'UCLA Bruins 14 - Illinois Fighting Illini 7');
 await checkUcla(s,now,feed(14,10,true),queue);
 assert.match(s.outbox.at(-1).subject,/^Final/);
 await checkUcla(s,now,async()=>{throw Error('should stop after final')},queue);
 assert.equal(s.errors.ucla,undefined);
});
test('UCLA feed failure preserves baseline and retries, subscription expires',async()=>{
 const s=initialState();
 await checkUcla(s,now,feed(7,7),queue);
 await checkUcla(s,now,async()=>{throw Error('offline')},queue);
 assert.equal(s.errors.ucla,'offline');
 await checkUcla(s,now,feed(7,14),queue);
 assert.equal(s.errors.ucla,undefined);
 assert.equal(s.outbox.length,1);
 await checkUcla(s,new Date('2026-11-16T08:00Z'),feed(21,14),queue);
 assert.equal(s.outbox.length,1);
});
