import test from 'node:test';
import assert from 'node:assert/strict';
import {semanticSelection,candidateTexts} from '../electron/semantic';
import {analyze} from '../electron/providers';
import {defaults} from '../electron/storage';
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
test('semantic failure visibly falls back to lexical selection',async()=>{
 const transcript:Transcript={version:1,duration:100,language:'en',segments:[0,50].map(start=>({start,end:start+40,text:'Why? Because this changed everything.',language:'en',words:Array.from({length:80},(_,i)=>({start:start+i*.5,end:start+i*.5+.45,text:i?'lesson':'Why?'}))}))};
 const reports:string[]=[];
 const result=await analyze(transcript,{...defaults,cloudEnabled:false},async()=>'',new AbortController().signal,m=>reports.push(m),fetch,async()=>{throw new Error('ONNX worker failed');});
 assert.ok(result.length>0);assert.ok(reports.some(s=>s.includes('Semantic comparison unavailable')));
});
test('semantic comparison receives candidates beyond the twelve-clip ceiling',async()=>{
 const transcript:Transcript={version:1,duration:800,language:'en',segments:Array.from({length:16},(_,i)=>({start:i*50,end:i*50+44.95,text:'Why did everything change? Because I learned the truth.',language:'en',words:Array.from({length:90},(_,j)=>({start:i*50+j*.5,end:i*50+j*.5+.45,text:j?'lesson':'Why?'}))}))};
 let count=0;
 const result=await analyze(transcript,{...defaults,cloudEnabled:false},async()=>'',new AbortController().signal,()=>{},fetch,async pool=>{count=pool.length;return pool.slice(0,12);});
 assert.equal(count,16);assert.equal(result.length,12);
});
