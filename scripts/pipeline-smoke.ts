import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store,hash} from '../electron/storage';
import {Service} from '../electron/service';
async function main(){
 const root=path.resolve('.test-data/pipeline');await fs.mkdir(root,{recursive:true});
 const store=new Store(path.join(root,'db.sqlite'));store.setSettings({...store.settings(),cloudEnabled:false});
 const service=new Service(root,path.resolve('runtime'),path.resolve('workers'),store,()=>{},()=>{});await service.init();
 const source=path.resolve('.test-data/speech/speech.mp4');const before=await hash(source);service.allowedInputs.add(source);const id=await service.create({kind:'local',value:source});
 let last='';while(true){await new Promise(r=>setTimeout(r,1000));const job=store.get(id)!;if(job.message!==last){console.log(job.stage,Math.round(job.progress),job.message);last=job.message;}
   if(job.stage==='failed')throw new Error(job.error);if(job.stage==='completed')break;
 }
 const job=store.get(id)!;if(!job.outputs.length)throw new Error('No clips selected from the speech test');
 if(before!==await hash(source))throw new Error('Original source changed');
 const external=await fs.mkdtemp(path.join(os.tmpdir(),'reelmind-export-'));await service.save(id,external,[root]);
 for(const reel of store.get(id)!.outputs){if(!reel.savedPath||!await fs.stat(reel.savedPath))throw new Error('External save failed');}
 console.log(JSON.stringify({id,clips:job.outputs.length,sourcePreserved:true,externalSaveVerified:true,external}));
 store.db.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
