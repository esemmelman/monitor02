import {test} from 'node:test';
import assert from 'node:assert/strict';
import {leaders,completedPeriods} from './logic.mjs';
test('quarter boundaries and overtime',()=>{assert.equal(completedPeriods({period:1,displayClock:'2:00',type:{}}),0);assert.equal(completedPeriods({period:2,displayClock:'12:00',type:{}}),1);assert.equal(completedPeriods({period:2,type:{detail:'Halftime'}}),2);assert.equal(completedPeriods({period:4,type:{completed:true}}),4);assert.equal(completedPeriods({period:5,displayClock:'0:00',type:{}}),5)});
test('leaders retain ties',()=>{const result=leaders([{team:{displayName:'Team'},statistics:[{names:['points','rebounds','assists'],athletes:[{athlete:{displayName:'A'},stats:['10','4','2']},{athlete:{displayName:'B'},stats:['10','5','3']}]}]}])[0];assert.match(result,/PTS: A, B \(10\)/);assert.match(result,/REB: B \(5\)/);assert.match(result,/AST: B \(3\)/)});
