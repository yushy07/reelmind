import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { Store, atomicJSON, removeWorkspace, externalDirectory, hash } from './storage';
import { DAY, validateUrl, planEdit } from './core';
import { analyze } from './providers';
import { run } from './process';
import { probe, render } from './media';
import type { Job, Stage, Transcript, Candidate, Frame, Provider } from '../shared/types';
const exists=async(file:string)=>!!await fs.stat(file).catch(()=>null);
export class Service {
  active=new Map<string,AbortController>();
  saving=new Set<string>();
  allowedInputs=new Set<string>();
  stopping=false;
  renderHardware={nvenc:false,cudaSpeechCandidate:false,cpuThreads:Math.max(2,Math.min(6,Math.floor(os.cpus().length/2)))};
  constructor(public root:string,public runtime:string,public workers:string,public store:Store,public changed:()=>void,public notify:(j:Job)=>void){}
  configureHardware(vramMb:number){this.renderHardware.nvenc=vramMb>=2048;this.renderHardware.cudaSpeechCandidate=vramMb>=4096;if(vramMb&&vramMb<4096)this.renderHardware.cpuThreads=Math.min(4,this.renderHardware.cpuThreads);}
  work(id:string){if(!/^[\da-f-]{36}$/.test(id))throw new Error('Invalid project');return path.join(this.root,'work',id);}
  out(id:string){this.work(id);return path.join(this.root,'outputs',id);}
  update(job:Job,patch:Partial<Job>){Object.assign(job,patch,{updatedAt:this.store.now()});this.store.put(job);this.changed();}
  async key(p:Provider){return run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.workers,'credentials.ps1')],{input:JSON.stringify({action:'get',provider:p})});}
  async setKey(p:Provider,key:string){await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.workers,'credentials.ps1')],{input:JSON.stringify({action:'set',provider:p,key})});}
  async readiness(){const required=['ffmpeg.exe','ffprobe.exe','yt-dlp.exe','python/python.exe','models/whisper-small/model.bin','models/whisper-small/config.json','models/whisper-small/vocabulary.txt','models/whisper-small/tokenizer.json','models/face.onnx','models/speaker.onnx','fonts/NotoSans-Bold.ttf','fonts/NotoSansDevanagari-Bold.ttf','fonts/NotoSansCJKjp-Bold.otf'];const missing=[];for(const f of required)if(!await exists(path.join(this.runtime,f)))missing.push(f);return {ready:!missing.length,missing};}
  async init(){await fs.mkdir(path.join(this.root,'work'),{recursive:true});await fs.mkdir(path.join(this.root,'outputs'),{recursive:true});const now=this.store.now();for(const j of this.store.jobs()){if(['importing','transcribing','analyzing','framing','rendering'].includes(j.stage)){this.update(j,{stage:'paused',message:'Processing was interrupted. Resume within 24 hours.',cleanupAt:Math.max(j.updatedAt,now)+DAY});}}await this.cleanup();this.pump();}
  async create(input:Job['input']){
    if(!(await this.readiness()).ready)throw new Error('Download the local engine in Settings first.');
    if(input.kind==='url')input.value=validateUrl(input.value);
    else if(!this.allowedInputs.has(input.value))throw new Error('Choose your local video with the file picker.');
    const now=this.store.now();const title=input.kind==='local'?path.basename(input.value):'Linked video';const job:Job={id:randomUUID(),name:input.name?.trim()||undefined,title,input,stage:'queued',checkpoint:'queued',progress:0,message:'Ready to process',createdAt:now,updatedAt:now,outputs:[],provider:'Local',fallbacks:[]};
    this.store.put(job);this.changed();this.pump();return job.id;
  }
  pump(){if(this.stopping||this.active.size)return;const job=this.store.jobs().reverse().find(j=>j.stage==='queued');if(job)void this.process(job);}
  async action(id:string,action:'pause'|'resume'|'delete'){
    const job=this.store.get(id);if(!job)throw new Error('Project not found.');
    if(this.saving.has(id))throw new Error('Wait for the save to finish.');
    if(action==='pause'){if(this.active.has(id))this.active.get(id)!.abort();else if(job.stage==='queued')this.update(job,{stage:'paused',cleanupAt:this.store.now()+DAY,message:'Paused · recover within 24 hours'});return;}
    if(this.active.has(id))throw new Error('Wait for processing to stop.');
    if(action==='delete'){await removeWorkspace(path.join(this.root,'work'),this.work(id));await removeWorkspace(path.join(this.root,'outputs'),this.out(id));this.store.remove(id);this.changed();return;}
    if(job.workingDeleted||job.stage==='expired')throw new Error('Recovery expired. Import your video again.');
    if(!['paused','failed'].includes(job.stage))throw new Error('This project cannot be resumed.');
    if(job.cleanupAt&&job.cleanupAt<=this.store.now()){await this.cleanup();throw new Error('Recovery expired. Import your video again.');}
    this.update(job,{stage:'queued',cleanupAt:undefined,error:undefined,message:'Resuming from saved progress'});this.pump();
  }
  async seal(file:string){await fs.writeFile(file+'.sha256',await hash(file),'utf8');}
  async checkpoint<T>(file:string,validate:(data:any)=>boolean,generate:()=>Promise<T>):Promise<T>{try{const value=JSON.parse(await fs.readFile(file,'utf8'));const expected=(await fs.readFile(file+'.sha256','utf8')).trim();if(validate(value)&&expected===await hash(file))return value;}catch{}const value=await generate();await atomicJSON(file,value);await this.seal(file);return value;}
  async process(job:Job){
    const controller=new AbortController();this.active.set(job.id,controller);const signal=controller.signal;const work=this.work(job.id);const output=this.out(job.id);
    const phase=(stage:Stage,progress:number,message:string)=>this.update(job,{stage,checkpoint:stage,progress,message,cleanupAt:undefined});
    try{
      await fs.mkdir(work,{recursive:true});await fs.mkdir(output,{recursive:true});
      phase('importing',2,'Preparing your video');
      let source=path.join(work,'source.mkv');
      if(job.input.kind==='local'){
        source=path.join(work,'source'+path.extname(job.input.value).toLowerCase());
        if(!await exists(source)){const stat=await fs.stat(job.input.value);const disk=await fs.statfs(work);if(Number(disk.bavail)*Number(disk.bsize)<stat.size*2+2e9)throw new Error('Not enough free disk space for source, working files and Reels.');await fs.copyFile(job.input.value,source+'.part');signal.throwIfAborted();await fs.rename(source+'.part',source);}
      }else if(!await exists(source)){
        const downloaderOptions={signal,env:{ELECTRON_RUN_AS_NODE:'1'}};
        const downloaderArgs=['--ignore-config','--no-playlist','--no-warnings','--js-runtimes',`node:${process.execPath}`,'--cache-dir',path.join(work,'download-cache')];
        const raw=await run(path.join(this.runtime,'yt-dlp.exe'),[...downloaderArgs,'--skip-download','--dump-single-json','--',job.input.value],downloaderOptions);const meta=JSON.parse(raw);
        if(meta.is_live||meta.live_status==='is_live'||meta.has_drm||meta.availability&& !['public','unlisted'].includes(meta.availability))throw new Error('Only public, non-live videos without DRM are supported.');
        if(meta.title)this.update(job,{title:String(meta.title).slice(0,180)});
        const disk=await fs.statfs(work);if(Number(disk.bavail)*Number(disk.bsize)<Math.max(2e9,Number(meta.filesize||meta.filesize_approx||0)*2))throw new Error('Not enough free disk space to download and process this video.');
        await run(path.join(this.runtime,'yt-dlp.exe'),[...downloaderArgs,'--max-filesize','20G','--ffmpeg-location',this.runtime,'-f','bv*[height<=1080]+ba/b[height<=1080]/b','--merge-output-format','mkv','--remux-video','mkv','-o',path.join(work,'source.%(ext)s'),'--',job.input.value],downloaderOptions);
      }
      const media=await probe(this.runtime,source,signal);this.update(job,{duration:media.duration});
      const audio=path.join(work,'audio.wav');
      if(!await exists(audio)){await run(path.join(this.runtime,'ffmpeg.exe'),['-y','-i',source,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',audio+'.part.wav'],{signal});await fs.rename(audio+'.part.wav',audio);}
      phase('transcribing',12,'Listening locally · English, Hindi and Japanese');
      const transcriptFile=path.join(work,'transcript.json');
      let transcript=await this.checkpoint<Transcript>(transcriptFile,d=>d.version===1&&Array.isArray(d.segments)&&d.segments.length,async()=>{
        await run(path.join(this.runtime,'python/python.exe'),[path.join(this.workers,'worker.py'),'transcribe','--input',audio,'--output',transcriptFile,'--models',path.join(this.runtime,'models'),...(this.renderHardware.cudaSpeechCandidate?['--gpu']:[])],{signal,progress:line=>{try{const p=JSON.parse(line);if(p.fallback){this.update(job,{fallbacks:[...new Set([...(job.fallbacks||[]),p.fallback])],message:p.message});}else this.update(job,{progress:12+p.progress*30,message:p.message});}catch{}}});return JSON.parse(await fs.readFile(transcriptFile,'utf8'));
      });
      phase('framing',43,'Matching voices and finding faces');
      const frames=await this.checkpoint<Frame[]>(path.join(work,'frames.json'),d=>Array.isArray(d),async()=>{
        await run(path.join(this.runtime,'python/python.exe'),[path.join(this.workers,'worker.py'),'frame','--input',source,'--audio',audio,'--transcript',transcriptFile,'--output',path.join(work,'frames.json'),'--models',path.join(this.runtime,'models')],{signal,progress:line=>{try{const p=JSON.parse(line);this.update(job,{progress:43+p.progress*10,message:p.message});}catch{}}});return JSON.parse(await fs.readFile(path.join(work,'frames.json'),'utf8'));
      });
      await this.seal(transcriptFile);
      transcript=JSON.parse(await fs.readFile(transcriptFile,'utf8'));
      phase('analyzing',54,'Finding moments across the entire video');
      const candidates=await this.checkpoint<Candidate[]>(path.join(work,'candidates.json'),d=>Array.isArray(d)&&d.every(c=>c.end-c.start>=30&&c.end-c.start<=60),()=>analyze(transcript,this.store.settings(),p=>this.key(p),signal,message=>this.update(job,{message,provider:message.startsWith('Gemini')?'Gemini':message.startsWith('OpenRouter')?'OpenRouter':message.startsWith('Local')?'Local':job.provider,fallbacks:message.startsWith('Fallback · ')?[...new Set([...(job.fallbacks||[]),message.slice('Fallback · '.length)])]:job.fallbacks})));
      if(!candidates.length){this.update(job,{stage:'completed',progress:100,message:'No strong 30–60 second moments found. Try a different video.',cleanupAt:this.store.now()+DAY});this.notify(job);return;}
      phase('rendering',62,`Creating ${candidates.length} Reels`);
      // Batches contain three clips; render one at a time to bound filter memory.
      for(let batch=0;batch<candidates.length;batch+=3){for(let i=batch;i<Math.min(batch+3,candidates.length);i++){
        signal.throwIfAborted();const id=String(i+1).padStart(2,'0');const file=path.join(output,`reelmind_${id}.mp4`);
        const previous=job.outputs.find(r=>r.id===id);if(previous&&await exists(file)){try{await probe(this.runtime,file,signal);continue;}catch{}}
        const plan=planEdit(candidates[i],transcript,frames,media.fps);const clipWork=path.join(work,'clip_'+id);await fs.mkdir(clipWork,{recursive:true});await atomicJSON(path.join(clipWork,'plan.json'),plan);await this.seal(path.join(clipWork,'plan.json'));
        this.update(job,{message:`Batch ${Math.floor(batch/3)+1} · rendering Reel ${i+1} of ${candidates.length}`});
        const partial=file+'.partial.mp4';await render(this.runtime,source,plan,partial,clipWork,this.store.settings().quality,this.renderHardware,signal,n=>this.update(job,{progress:62+(i+n)/candidates.length*37}),message=>this.update(job,{fallbacks:[...new Set([...(job.fallbacks||[]),message])],message}));await fs.rename(partial,file);
        job.outputs=job.outputs.filter(r=>r.id!==id);job.outputs.push({id,title:candidates[i].hook.slice(0,100),duration:plan.duration,file,reason:candidates[i].reason});this.update(job,{outputs:job.outputs});
      }}
      this.update(job,{stage:'completed',progress:100,message:`${job.outputs.length} Reels ready to save`,cleanupAt:this.store.now()+DAY});this.notify(job);
    }catch(error){this.update(job,{stage:signal.aborted?'paused':'failed',cleanupAt:this.store.now()+DAY,message:signal.aborted?'Paused · resume within 24 hours':'Processing needs attention',error:signal.aborted?undefined:String(error instanceof Error?error.message:error).slice(0,1600)});}
    finally{this.active.delete(job.id);this.pump();}
  }
  async save(id:string,dir:string,blocked:string[]){
    const job=this.store.get(id);if(!job||!['completed','expired'].includes(job.stage))throw new Error('Finish rendering before saving.');
    if(this.saving.has(id))throw new Error('Already saving.');this.saving.add(id);
    try{
      const dest=await externalDirectory(dir,blocked);
      for(const reel of job.outputs){if(reel.savedPath)continue;
        let target=path.join(dest,path.basename(reel.file));let suffix=1;while(await exists(target))target=path.join(dest,`reelmind_${reel.id}_${suffix++}.mp4`);
        const partial=target+'.'+randomUUID()+'.partial';
        try{await fs.copyFile(reel.file,partial,1);const expected=await hash(reel.file);if(expected!==await hash(partial))throw new Error('Saved copy did not match. Your internal Reel is safe.');await probe(this.runtime,partial);await fs.copyFile(partial,target,1);if(expected!==await hash(target))throw new Error('Saved file verification failed. Your internal Reel is safe.');await fs.unlink(partial);}
        catch(error){await fs.unlink(partial).catch(()=>{});throw error;}
        reel.savedPath=target;this.update(job,{outputs:job.outputs});await fs.unlink(reel.file).catch(()=>{});
      }
      this.update(job,{message:'All Reels saved outside REELMIND'});return dest;
    }finally{this.saving.delete(id);}
  }
  async cleanup(){for(const job of this.store.jobs()){
    if(this.active.has(job.id)||this.saving.has(job.id)||job.workingDeleted||!job.cleanupAt||job.cleanupAt>this.store.now())continue;
    await removeWorkspace(path.join(this.root,'work'),this.work(job.id));
    // Incomplete renders are temporary; completed outputs survive expiry.
    if(await exists(this.out(job.id)))for(const name of await fs.readdir(this.out(job.id))){if(name.endsWith('.partial.mp4'))await fs.unlink(path.join(this.out(job.id),name));}
    job.input.value='';this.update(job,{workingDeleted:true,stage:job.stage==='completed'?'completed':'expired',message:job.stage==='completed'?'Working files cleaned up · finished Reels remain':'Recovery expired · import the source again',error:undefined});
  }}
  async shutdown(){this.stopping=true;for(const [id,controller] of this.active){const job=this.store.get(id);if(job)this.update(job,{stage:'paused',cleanupAt:this.store.now()+DAY,message:'Paused when the app closed'});controller.abort();}while(this.active.size)await new Promise(r=>setTimeout(r,50));}
}
