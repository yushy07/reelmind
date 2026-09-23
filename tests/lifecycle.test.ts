import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../electron/storage';
import {Service} from '../electron/service';
import {DAY} from '../electron/core';
import type {Job} from '../shared/types';
test('jobs snapshot Turbo while later settings changes do not alter resume',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reelmind-mode-'));const store=new Store(path.join(root,'db.sqlite'));const service=new Service(root,'unused','unused',store,()=>{},()=>{});service.stopping=true;service.readiness=async()=>({ready:true,missing:[]});
 try{store.setSettings({...store.settings(),transcriptionMode:'turbo'});await assert.rejects(()=>service.create({kind:'url',value:'https://youtu.be/example'}),/Download Turbo/);service.models.state.ready=true;const id=await service.create({kind:'url',value:'https://youtu.be/example'});assert.equal(store.get(id)?.transcriptionMode,'turbo');store.setSettings({...store.settings(),transcriptionMode:'standard'});await service.action(id,'pause');await service.action(id,'resume');assert.equal(store.get(id)?.transcriptionMode,'turbo');assert.ok(store.get(id)?.modelRevision);}
 finally{store.db.close();await fs.rm(root,{recursive:true,force:true});}
});
test('named projects keep their chosen name separately from the source title',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reelmind-name-'));const store=new Store(path.join(root,'db.sqlite'));const service=new Service(root,'unused','unused',store,()=>{},()=>{});service.stopping=true;service.readiness=async()=>({ready:true,missing:[]});
 try{const id=await service.create({kind:'url',value:'https://youtu.be/example',name:'  My podcast  '});const job=store.get(id)!;assert.equal(job.name,'My podcast');assert.equal(job.title,'Linked video');assert.equal(job.stage,'queued');service.update(job,{title:'Downloaded video title'});assert.equal(store.get(id)?.name,'My podcast');const unnamedId=await service.create({kind:'url',value:'https://youtu.be/example',name:'  '});const unnamed=store.get(unnamedId)!;service.update(unnamed,{title:'Detected source title'});const restored=store.get(unnamedId)!;assert.equal(restored.name||restored.title,'Detected source title');}
 finally{store.db.close();await fs.rm(root,{recursive:true,force:true});}
});
test('expired completed workspace is cleaned, unsaved reels are retained',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reelmind-life-'));const store=new Store(path.join(root,'db.sqlite'));const service=new Service(root,'unused','unused',store,()=>{},()=>{});
 try{await service.init();const id=randomUUID(),file=path.join(service.out(id),'reelmind_01.mp4');await fs.mkdir(service.work(id),{recursive:true});await fs.mkdir(service.out(id),{recursive:true});await fs.writeFile(path.join(service.work(id),'source.mp4'),'source');await fs.writeFile(file,'finished');await fs.writeFile(file+'.partial.mp4','incomplete');
 const job:Job={id,title:'Test',input:{kind:'local',value:'original.mp4'},stage:'completed',checkpoint:'rendering',progress:100,message:'Ready',createdAt:Date.now()-DAY*2,updatedAt:Date.now()-DAY*2,cleanupAt:Date.now()-1,outputs:[{id:'01',title:'A moment',duration:40,file,reason:'test'}],provider:'Local'};store.put(job);await service.cleanup();assert.equal(await fs.readFile(file,'utf8'),'finished');assert.equal((await fs.stat(service.work(id)).catch(()=>null)),null);assert.equal(store.get(id)?.workingDeleted,true);assert.equal(store.get(id)?.input.value,'');await service.cleanup();assert.equal(await fs.readFile(file,'utf8'),'finished');
 }finally{store.db.close();await fs.rm(root,{recursive:true,force:true});}
});
test('interrupted job resumes only within its recovery window',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reelmind-resume-'));const store=new Store(path.join(root,'db.sqlite'));const service=new Service(root,'unused','unused',store,()=>{},()=>{});service.stopping=true;
 try{await service.init();const id=randomUUID();const job:Job={id,title:'Interrupted',input:{kind:'local',value:'source'},stage:'paused',checkpoint:'transcribing',progress:20,message:'Paused',createdAt:Date.now(),updatedAt:Date.now(),cleanupAt:Date.now()+DAY,outputs:[],provider:'Local'};store.put(job);await service.action(id,'resume');assert.equal(store.get(id)?.stage,'queued');assert.equal(store.get(id)?.checkpoint,'transcribing');assert.equal(store.get(id)?.cleanupAt,undefined);store.put({...job,stage:'paused',cleanupAt:Date.now()-1});await assert.rejects(()=>service.action(id,'resume'),/Recovery expired/);assert.equal(store.get(id)?.stage,'expired');
 }finally{store.db.close();await fs.rm(root,{recursive:true,force:true});}
});
test('clock rollback cannot extend cleanup deadlines',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reelmind-clock-'));const store=new Store(path.join(root,'db.sqlite'));
 try{assert.equal(store.now(10_000),10_000);assert.equal(store.now(1_000),10_000);assert.equal(store.now(20_000),20_000);}finally{store.db.close();await fs.rm(root,{recursive:true,force:true});}
});
test('corrupt checkpoint is regenerated while a valid checkpoint is reused',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reelmind-checkpoint-'));const store=new Store(path.join(root,'db.sqlite'));const service=new Service(root,'unused','unused',store,()=>{},()=>{});const file=path.join(root,'stage.json');let generated=0;
 try{const make=async()=>({ok:true,value:++generated});assert.equal((await service.checkpoint(file,d=>d.ok===true,make)).value,1);assert.equal((await service.checkpoint(file,d=>d.ok===true,make)).value,1);await fs.writeFile(file,'{"ok":true,"value":999}');assert.equal((await service.checkpoint(file,d=>d.ok===true,make)).value,2);}finally{store.db.close();await fs.rm(root,{recursive:true,force:true});}
});
test('checkpoint is regenerated when upstream dependency changes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reelmind-dependency-'));const store=new Store(path.join(root,'db.sqlite'));const service=new Service(root,'unused','unused',store,()=>{},()=>{});let count=0;
 try{const file=path.join(root,'stage.json'),make=async()=>({value:++count});await service.checkpoint(file,()=>true,make,'a');await service.checkpoint(file,()=>true,make,'a');assert.equal(count,1);await service.checkpoint(file,()=>true,make,'b');assert.equal(count,2);}finally{store.db.close();await fs.rm(root,{recursive:true,force:true});}
});
