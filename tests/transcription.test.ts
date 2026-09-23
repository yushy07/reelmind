import test from 'node:test';
import assert from 'node:assert/strict';
import {transcribeWithFallback} from '../electron/transcription';
test('Turbo process failure retries small CPU once',async()=>{
 const calls:string[]=[];let notices=0;
 const result=await transcribeWithFallback('turbo',undefined,new AbortController().signal,async(mode,cpu)=>{calls.push(mode+':'+cpu);if(mode==='turbo')throw new Error('Worker exited');return 'transcript';},()=>notices++);
 assert.equal(result,'transcript');assert.deepEqual(calls,['turbo:true','standard:true']);assert.equal(notices,1);
});
test('user pause never triggers another transcription worker',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(transcribeWithFallback('turbo',undefined,controller.signal,async()=>{calls++;controller.abort();throw new Error('terminated');},()=>assert.fail('Unexpected fallback')));assert.equal(calls,1);
});
test('resumed small fallback skips Turbo and Standard failures surface',async()=>{
 const calls:string[]=[];
 await assert.rejects(transcribeWithFallback('turbo','standard',new AbortController().signal,async mode=>{calls.push(mode);throw new Error('No speech');},()=>assert.fail('Unexpected fallback')),/No speech/);assert.deepEqual(calls,['standard']);
});
