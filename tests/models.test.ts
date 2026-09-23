import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ModelManager} from '../electron/models';
const content=Buffer.from('verified model fixture');
const spec={repository:'test/model',revision:'abc',license:'MIT',files:[{name:'model.bin',remote:'model.bin',size:content.length,sha256:createHash('sha256').update(content).digest('hex')}]};
async function fixture(fn:(root:string)=>Promise<void>){const root=await fs.mkdtemp(path.join(os.tmpdir(),'reelmind-model-'));try{await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
test('verified model promotes atomically and reopens offline',()=>fixture(async root=>{
 const manager=new ModelManager(root,()=>{},async()=>new Response(content),spec);await manager.init();assert.equal(manager.state.ready,false);await manager.download(new AbortController().signal);assert.equal(manager.state.ready,true);
 const offline=new ModelManager(root,()=>{},async()=>{throw new Error('offline');},spec);await offline.init();assert.equal(offline.state.ready,true);assert.equal(await fs.readFile(path.join(offline.directory(),'model.bin'),'utf8'),content.toString());
}));
test('partial model resumes with validated range',()=>fixture(async root=>{
 const manager=new ModelManager(root,()=>{},async(_url,options)=>{assert.equal((options?.headers as Record<string,string>).Range,'bytes=5-');return new Response(content.subarray(5),{status:206,headers:{'content-range':`bytes 5-${content.length-1}/${content.length}`}});},spec);
 await fs.mkdir(manager.staging(),{recursive:true});await fs.writeFile(path.join(manager.staging(),'model.bin.part'),content.subarray(0,5));await manager.download(new AbortController().signal);assert.equal(manager.state.ready,true);
}));
test('bad hashes and incorrect ranges never mark a model ready',()=>fixture(async root=>{
 const manager=new ModelManager(root,()=>{},async()=>new Response(Buffer.alloc(content.length)),spec);await assert.rejects(manager.download(new AbortController().signal),/verification/);assert.equal(manager.state.ready,false);
 const badRange=new ModelManager(root,()=>{},async()=>new Response(content,{status:206,headers:{'content-range':'bytes 1-2/3'}}),spec);await assert.rejects(badRange.download(new AbortController().signal),/range/);
}));
test('cancellation preserves staging without promoting it',()=>fixture(async root=>{
 const controller=new AbortController();const manager=new ModelManager(root,()=>{},async()=>{controller.abort();return new Response(content);},spec);await assert.rejects(manager.download(controller.signal));assert.equal(manager.state.ready,false);assert.equal(await fs.stat(manager.directory()).catch(()=>null),null);
}));
test('expired partial downloads are removed but installed models survive',()=>fixture(async root=>{
 const manager=new ModelManager(root,()=>{},async()=>new Response(content),spec);await manager.download(new AbortController().signal);
 await fs.mkdir(manager.staging(),{recursive:true});await fs.writeFile(path.join(manager.staging(),'model.bin.part'),'partial');const past=new Date(Date.now()-25*3600000);await fs.utimes(manager.staging(),past,past);await manager.cleanup();assert.equal(await fs.stat(manager.staging()).catch(()=>null),null);assert.equal(await manager.valid(manager.directory()),true);
}));
test('insufficient space prevents any network request',()=>fixture(async root=>{
 const huge={...spec,files:spec.files.map(f=>({...f,size:Number.MAX_SAFE_INTEGER}))};
 const manager=new ModelManager(root,()=>{},async()=>{assert.fail('Must not download without disk space');},huge);
 await assert.rejects(manager.download(new AbortController().signal),/Not enough disk space/);assert.equal(manager.state.ready,false);
}));
test('server ignoring Range restarts the file without appending corrupt data',()=>fixture(async root=>{
 const manager=new ModelManager(root,()=>{},async()=>new Response(content),spec);
 await fs.mkdir(manager.staging(),{recursive:true});await fs.writeFile(path.join(manager.staging(),'model.bin.part'),content.subarray(0,5));await manager.download(new AbortController().signal);assert.equal(await manager.valid(manager.directory()),true);
}));
