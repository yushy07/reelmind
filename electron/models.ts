import fs from 'node:fs/promises';
import path from 'node:path';
import {hash,atomicJSON,removeWorkspace} from './storage';
import manifest from '../shared/model-manifest.json';
export const TURBO=manifest.turbo;
export interface ModelStatus {ready:boolean;running:boolean;downloaded:number;total:number;freeBytes:number;message:string;error?:string}
export class ModelManager {
  state:ModelStatus={ready:false,running:false,downloaded:0,total:TURBO.files.reduce((n,f)=>n+f.size,0),freeBytes:0,message:'Optional one-time download · CPU INT8'};
  controller?:AbortController;
  task?:Promise<void>;
  constructor(public root:string,private changed:()=>void,private request:typeof fetch=fetch,private spec=TURBO){this.state.total=spec.files.reduce((n,f)=>n+f.size,0);}
  directory(revision=this.spec.revision){if(revision!==this.spec.revision)throw new Error('Unsupported Turbo revision');return path.join(this.root,'models','whisper-turbo',revision);}
  staging(){return path.join(this.root,'model-downloads','whisper-turbo-'+this.spec.revision);}
  async valid(directory:string){for(const f of this.spec.files){const file=path.join(directory,f.name);if((await fs.stat(file).catch(()=>null))?.size!==f.size||await hash(file)!==f.sha256)return false;}return true;}
  async init(){
    await fs.mkdir(this.root,{recursive:true});
    const disk=await fs.statfs(this.root);this.state.freeBytes=Number(disk.bavail)*Number(disk.bsize);
    try{const marker=JSON.parse(await fs.readFile(path.join(this.directory(),'ready.json'),'utf8'));this.state.ready=marker.revision===this.spec.revision&&await this.valid(this.directory());}catch{this.state.ready=false;}
    if(this.state.ready)this.state.message='Turbo installed · works offline · CPU INT8';
  }
  cancel(){this.controller?.abort();}
  async cleanup(now=Date.now()){
    if(this.state.running)return;
    const partial=await fs.stat(this.staging()).catch(()=>null);
    if(partial&&now-partial.mtimeMs>=24*60*60*1000)await removeWorkspace(path.join(this.root,'model-downloads'),this.staging());
  }
  start(){
    if(this.state.running||this.state.ready)return;
    this.controller=new AbortController();this.state.running=true;this.state.error=undefined;this.changed();
    this.task=this.download(this.controller.signal).catch(error=>{
      this.state.message=this.controller?.signal.aborted?'Download paused · resume when ready':'Download failed · Standard is still available';
      this.state.error=this.controller?.signal.aborted?undefined:(error instanceof Error?error.message:'Model download failed');
    }).finally(()=>{this.state.running=false;this.changed();});
  }
  async download(signal:AbortSignal){
    const stage=this.staging();await fs.mkdir(stage,{recursive:true});await fs.utimes(stage,new Date(),new Date());
    let completed=0;let lastReport=0;
    for(const spec of this.spec.files){
      signal.throwIfAborted();const file=path.join(stage,spec.name),partial=file+'.part';
      if((await fs.stat(file).catch(()=>null))?.size===spec.size&&await hash(file)===spec.sha256){completed+=spec.size;continue;}
      let offset=(await fs.stat(partial).catch(()=>null))?.size||0;
      if(offset>spec.size){await fs.unlink(partial);offset=0;}
      const disk=await fs.statfs(stage);this.state.freeBytes=Number(disk.bavail)*Number(disk.bsize);
      const remaining=this.state.total-completed-offset;
      if(this.state.freeBytes<remaining+512e6)throw new Error('Not enough disk space. Free at least '+Math.ceil((remaining+512e6)/1e9)+' GB and retry.');
      if(offset<spec.size){
        this.state.message='Downloading Turbo · '+spec.name;
        const response=await this.request(`https://huggingface.co/${this.spec.repository}/resolve/${this.spec.revision}/${spec.remote}`,{headers:offset?{Range:`bytes=${offset}-`}:{},signal:AbortSignal.any([signal,AbortSignal.timeout(60*60*1000)])});
        if(!response.ok||!response.body)throw new Error(`Model download unavailable (${response.status}). Retry later.`);
        if(response.status===206){if(response.headers.get('content-range')!==`bytes ${offset}-${spec.size-1}/${spec.size}`)throw new Error('Invalid download range');}
        else if(response.status===200)offset=0;
        else throw new Error('Unexpected download response');
        const handle=await fs.open(partial,offset?'a':'w');
        const reader=response.body.getReader();
        try{while(true){signal.throwIfAborted();const {done,value:chunk}=await reader.read();if(done)break;if(offset+chunk.length>spec.size)throw new Error('Downloaded model exceeds expected size');let written=0;while(written<chunk.length){const result=await handle.write(chunk,written,chunk.length-written);written+=result.bytesWritten;}offset+=chunk.length;this.state.downloaded=completed+offset;if(Date.now()-lastReport>250){lastReport=Date.now();this.changed();}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();await handle.close();await fs.utimes(stage,new Date(),new Date());}
      }
      this.state.message='Verifying Turbo · '+spec.name;this.changed();
      if(offset!==spec.size||await hash(partial)!==spec.sha256){await fs.unlink(partial).catch(()=>{});throw new Error('Model verification failed. Retry to download a clean copy.');}
      await fs.rename(partial,file);completed+=spec.size;
    }
    signal.throwIfAborted();
    await atomicJSON(path.join(stage,'ready.json'),{revision:this.spec.revision});
    await fs.mkdir(path.dirname(this.directory()),{recursive:true});
    // An invalid previous installation is quarantined, never merged with new files.
    if(await fs.stat(this.directory()).catch(()=>null))await fs.rename(this.directory(),this.directory()+'.invalid-'+Date.now());
    await fs.rename(stage,this.directory());
    this.state.ready=true;this.state.downloaded=this.state.total;this.state.message='Turbo installed · works offline · CPU INT8';
  }
}
