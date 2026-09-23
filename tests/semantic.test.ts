import test from 'node:test';
import assert from 'node:assert/strict';
import {semanticSelection,candidateTexts} from '../electron/semantic';
import type {Candidate,Transcript} from '../shared/types';
const c=(start:number,score=80):Candidate=>({start,end:start+35,score,hook:'hook',context:'context',payoff:'payoff',category:'story',reason:'strong'});
const vector=(index:number)=>Array.from({length:384},(_,i)=>i===index?1:0);
test('semantic selection keeps strongest duplicate and distinct stories',()=>{
  assert.deepEqual(semanticSelection([c(0,70),c(40,90),c(80)],[vector(0),vector(0),vector(1)]).map(c=>c.start),[40,80]);
});
test('semantic selection validates vectors and caps output at twelve',()=>{
  assert.throws(()=>semanticSelection([c(0)],[[]]));
  assert.throws(()=>semanticSelection([c(0)],[Array(384).fill(0)]));
  assert.throws(()=>semanticSelection([c(0)],[]));
  assert.equal(semanticSelection(Array.from({length:20},(_,i)=>c(i*40)),Array.from({length:20},(_,i)=>vector(i))).length,12);
});
test('candidate text uses actual transcript words rather than generated hooks',()=>{
  const t:Transcript={version:1,language:'ja',duration:100,segments:[{start:0,end:70,text:'not used',language:'ja',words:[{start:1,end:2,text:'こんにちは'},{start:60,end:61,text:'excluded'}]}]};
  assert.deepEqual(candidateTexts([c(0)],t),['こんにちは']);
});
