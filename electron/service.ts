import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import { Store, atomicJSON, removeWorkspace, externalDirectory, hash } from './storage';
import { DAY, validateUrl, planEdit } from './core';
import { analyze } from './providers';
import { candidateTexts, semanticSelection, SEMANTIC_VERSION } from './semantic';
import { ModelManager, TURBO } from './models';
import { transcribeWithFallback } from './transcription';
import { run } from './process';
import { probe, render } from './media';
import type { Job, Stage, Transcript, Candidate, Frame, Provider, CreateInput, AnimeCreateInput, AnimeShot, MusicMap, AnimeEpisodeAnalysis, AnimeCandidate, AnimeEditConcept, AnimeRerenderOptions } from '../shared/types';
import { selectAnimeMoments } from './anime/selection';
import { planAnimeEdit } from './anime/planner';
import { renderAnimeAMV } from './anime/renderer';
import { parsePastedTranscript } from './pasted-transcript';
const exists=async(file:string)=>!!await fs.stat(file).catch(()=>null);
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Service {
  active=new Map<string,AbortController>();
  saving=new Set<string>();
  allowedInputs=new Set<string>();
  stopping=false;
  renderHardware={nvenc:false,cudaSpeechCandidate:false,cpuThreads:Math.max(2,Math.min(6,Math.floor(os.cpus().length/2)))};
  models:ModelManager;
  constructor(public root:string,public runtime:string,public workers:string,public store:Store,public changed:()=>void,public notify:(j:Job)=>void){this.models=new ModelManager(root,changed);}
  configureHardware(vramMb:number){this.renderHardware.nvenc=vramMb>=2048;this.renderHardware.cudaSpeechCandidate=vramMb>=4096;if(vramMb&&vramMb<4096)this.renderHardware.cpuThreads=Math.min(4,this.renderHardware.cpuThreads);}
  work(id:string){if(!/^[\da-f-]{36}$/.test(id))throw new Error('Invalid project');return path.join(this.root,'work',id);}
  out(id:string){this.work(id);return path.join(this.root,'outputs',id);}
  update(job:Job,patch:Partial<Job>){Object.assign(job,patch,{updatedAt:this.store.now()});this.store.put(job);this.changed();}
  async key(p:Provider){return run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.workers,'credentials.ps1')],{input:JSON.stringify({action:'get',provider:p})});}
  async setKey(p:Provider,key:string){await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.workers,'credentials.ps1')],{input:JSON.stringify({action:'set',provider:p,key})});}
  async readiness(){const required=['ffmpeg.exe','ffprobe.exe','yt-dlp.exe','python/python.exe','models/whisper-small/model.bin','models/whisper-small/config.json','models/whisper-small/vocabulary.txt','models/whisper-small/tokenizer.json','models/face.onnx','models/speaker.onnx','fonts/NotoSans-Bold.ttf','fonts/NotoSansDevanagari-Bold.ttf','fonts/NotoSansCJKjp-Bold.otf'];const missing=[];for(const f of required)if(!await exists(path.join(this.runtime,f)))missing.push(f);return {ready:!missing.length,missing};}
  async init(){await fs.mkdir(path.join(this.root,'work'),{recursive:true});await fs.mkdir(path.join(this.root,'outputs'),{recursive:true});const now=this.store.now();for(const j of this.store.jobs()){if(['importing','transcribing','analyzing','framing','rendering'].includes(j.stage)){this.update(j,{stage:'paused',message:'Processing was interrupted. Resume within 24 hours.',cleanupAt:Math.max(j.updatedAt,now)+DAY});}}await this.cleanup();this.pump();}
  async create(request:CreateInput){
    const {pastedTranscript,...input}=request;
    if(!(await this.readiness()).ready)throw new Error('Download the local engine in Settings first.');
    if(pastedTranscript!==undefined){if(!pastedTranscript.trim())throw new Error('Paste transcript text or leave it blank to transcribe the video.');if(pastedTranscript.length>200_000)throw new Error('Transcript is too long. Keep it under 200,000 characters.');}
    if(input.kind==='url')input.value=validateUrl(input.value);
    else if(!this.allowedInputs.has(input.value))throw new Error('Choose your local video with the file picker.');
    const now=this.store.now();const title=input.kind==='local'?path.basename(input.value):'Linked video';const job:Job={id:randomUUID(),name:input.name?.trim()||undefined,title,input,stage:'queued',checkpoint:'queued',progress:0,message:'Ready to process',createdAt:now,updatedAt:now,outputs:[],provider:'Local',fallbacks:[]};
    job.transcriptSource=pastedTranscript===undefined?'whisper':'pasted';
    job.transcriptionMode=this.store.settings().transcriptionMode||'standard';
    if(job.transcriptSource==='whisper'&&job.transcriptionMode==='turbo'&&!this.models.state.ready)throw new Error('Download Turbo in Settings first, or choose Standard.');
    job.modelRevision=job.transcriptionMode==='turbo'?TURBO.revision:'whisper-small-bundled';
    if(pastedTranscript!==undefined){const work=this.work(job.id);await fs.mkdir(work,{recursive:true});const inputFile=path.join(work,'pasted-transcript.txt');await fs.writeFile(inputFile+'.part',pastedTranscript,'utf8');await fs.rename(inputFile+'.part',inputFile);}
    this.store.put(job);this.changed();this.pump();return job.id;
  }
  async createAnime(request:AnimeCreateInput){
    if(!(await this.readiness()).ready)throw new Error('Download the local engine in Settings first.');
    if(!this.allowedInputs.has(request.episodePath))throw new Error('Choose your anime episode with the file picker.');
    if(!this.allowedInputs.has(request.musicPath))throw new Error('Choose your music track with the file picker.');
    const now=this.store.now();const title=request.name?.trim()||path.basename(request.episodePath);
    const job:Job={id:randomUUID(),studio:'anime',name:request.name?.trim()||undefined,title,input:{kind:'local',value:request.episodePath,musicPath:request.musicPath,language:request.language||'ja',name:request.name?.trim()||undefined},stage:'queued',checkpoint:'queued',progress:0,message:'Ready to analyze anime episode',createdAt:now,updatedAt:now,outputs:[],provider:'Local',fallbacks:[]};
    this.store.put(job);this.changed();this.pump();return job.id;
  }
  pump(){if(this.stopping||this.active.size)return;const job=this.store.jobs().reverse().find(j=>j.stage==='queued');if(job){if(job.studio==='anime')void this.processAnime(job);else void this.process(job);}}
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
  async checkpoint<T>(file:string,validate:(data:any)=>boolean,generate:()=>Promise<T>,dependency?:string):Promise<T>{try{const value=JSON.parse(await fs.readFile(file,'utf8'));const expected=(await fs.readFile(file+'.sha256','utf8')).trim();const matches=!dependency||await fs.readFile(file+'.dependency','utf8')===dependency;if(matches&&validate(value)&&expected===await hash(file))return value;}catch{}const value=await generate();await atomicJSON(file,value);await this.seal(file);if(dependency)await fs.writeFile(file+'.dependency',dependency,'utf8');return value;}
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
      phase('transcribing',12,job.transcriptSource==='pasted'?'Aligning your pasted transcript':'Listening locally · English, Hindi and Japanese');
      const transcriptFile=path.join(work,'transcript.json');
      let transcript=await this.checkpoint<Transcript>(transcriptFile,d=>d.version===1&&Array.isArray(d.segments)&&d.segments.length,async()=>{
        // Regeneration invalidates speaker assignments and downstream decisions.
        await fs.unlink(path.join(work,'frames.json.sha256')).catch(()=>{});
        await fs.unlink(path.join(work,'candidates.json.sha256')).catch(()=>{});
        if(job.transcriptSource==='pasted'){
          const pasted=await fs.readFile(path.join(work,'pasted-transcript.txt'),'utf8');
          const value=parsePastedTranscript(pasted,media.duration);
          this.update(job,{transcriptTiming:value.timingSource,message:value.timingSource==='estimated'?'Pasted transcript · estimated timing; captions may drift':'Pasted transcript · subtitle timing preserved'});
          return value;
        }
        const transcribe=async(mode:'standard'|'turbo',cpuOnly=false)=>{
          const args=[path.join(this.workers,'worker.py'),'transcribe','--input',audio,'--output',transcriptFile,'--models',path.join(this.runtime,'models')];
          if(mode==='turbo')args.push('--model-path',this.models.directory(job.modelRevision));
          else if(!cpuOnly&&this.renderHardware.cudaSpeechCandidate)args.push('--gpu');
          await run(path.join(this.runtime,'python/python.exe'),args,{signal,progress:line=>{try{const p=JSON.parse(line);if(p.fallback){this.update(job,{fallbacks:[...new Set([...(job.fallbacks||[]),p.fallback])],message:p.message});}else if(Number.isFinite(p.progress))this.update(job,{progress:12+p.progress*30,message:`${mode==='turbo'?'Turbo':'Standard'} · ${p.message}`});}catch{}}});
          const value=JSON.parse(await fs.readFile(transcriptFile,'utf8'));if(value.version!==1||!value.segments?.length)throw new Error('Transcription returned no usable speech');
          this.update(job,{effectiveTranscriptionMode:mode});return value as Transcript;
        };
        return transcribeWithFallback(job.transcriptionMode||'standard',job.effectiveTranscriptionMode,signal,transcribe,()=>this.update(job,{effectiveTranscriptionMode:'standard',message:'Turbo unavailable · retrying with Whisper small',fallbacks:[...new Set([...(job.fallbacks||[]),'Turbo transcription failed; using Whisper small on CPU'])]}));
      },fingerprint({audio:await hash(audio),mode:job.transcriptionMode||'standard',revision:job.modelRevision||'whisper-small-bundled',transcriptSource:job.transcriptSource||'whisper',pastedHash:job.transcriptSource==='pasted'?await hash(path.join(work,'pasted-transcript.txt')):undefined,version:2}));
      this.update(job,{transcriptTiming:transcript.timingSource||(job.transcriptSource==='pasted'?'provided':'whisper')});
      phase('framing',43,'Matching voices and finding faces');
      const frames=await this.checkpoint<Frame[]>(path.join(work,'frames.json'),d=>Array.isArray(d),async()=>{
        await run(path.join(this.runtime,'python/python.exe'),[path.join(this.workers,'worker.py'),'frame','--input',source,'--audio',audio,'--transcript',transcriptFile,'--output',path.join(work,'frames.json'),'--models',path.join(this.runtime,'models')],{signal,progress:line=>{try{const p=JSON.parse(line);this.update(job,{progress:43+p.progress*10,message:p.message});}catch{}}});return JSON.parse(await fs.readFile(path.join(work,'frames.json'),'utf8'));
      },fingerprint(transcript.segments.map(({speaker,...segment})=>segment)));
      await this.seal(transcriptFile);
      transcript=JSON.parse(await fs.readFile(transcriptFile,'utf8'));
      phase('analyzing',54,'Finding moments across the entire video');
      const candidates=await this.checkpoint<Candidate[]>(path.join(work,'candidates.json'),d=>Array.isArray(d)&&d.every(c=>c.end-c.start>=30&&c.end-c.start<=60),()=>analyze(transcript,this.store.settings(),p=>this.key(p),signal,message=>this.update(job,{message,provider:message.startsWith('Gemini')?'Gemini':message.startsWith('OpenRouter')?'OpenRouter':message.startsWith('Local')?'Local':job.provider,fallbacks:message.startsWith('Fallback · ')?[...new Set([...(job.fallbacks||[]),message.slice('Fallback · '.length)])]:job.fallbacks}),fetch,async pool=>{
        if(pool.length<2)return pool;
        this.update(job,{message:'Comparing ideas locally · MiniLM'});
        const input=path.join(work,'embedding-input.json'),output=path.join(work,'embeddings.json');
        await atomicJSON(input,candidateTexts(pool,transcript));
        await run(path.join(this.runtime,'python/python.exe'),[path.join(this.workers,'semantic.py'),'--input',input,'--output',output,'--models',path.join(this.runtime,'models','minilm')],{signal});
        const vectors=JSON.parse(await fs.readFile(output,'utf8'));
        const selected=semanticSelection(pool,vectors);
        await atomicJSON(path.join(work,'embedding-manifest.json'),{version:SEMANTIC_VERSION,transcript:await hash(transcriptFile),input:await hash(input),ranges:pool.map(c=>[c.start,c.end])});
        return selected;
      }),fingerprint({transcript,version:SEMANTIC_VERSION}));
      if(!candidates.length){this.update(job,{stage:'completed',progress:100,message:'No strong 30–60 second moments found. Try a different video.',cleanupAt:this.store.now()+DAY});this.notify(job);return;}
      phase('rendering',62,`Creating ${candidates.length} Reels`);
      // Batches contain three clips; render one at a time to bound filter memory.
      for(let batch=0;batch<candidates.length;batch+=3){for(let i=batch;i<Math.min(batch+3,candidates.length);i++){
        signal.throwIfAborted();const id=String(i+1).padStart(2,'0');const file=path.join(output,`reelmind_${id}.mp4`);
        const plan=planEdit(candidates[i],transcript,frames,media.fps);const planHash=fingerprint({plan,quality:this.store.settings().quality});
        const previous=job.outputs.find(r=>r.id===id);if(previous?.planHash===planHash&&await exists(file)){try{await probe(this.runtime,file,signal);continue;}catch{}}
        const clipWork=path.join(work,'clip_'+id);await fs.mkdir(clipWork,{recursive:true});await atomicJSON(path.join(clipWork,'plan.json'),plan);await this.seal(path.join(clipWork,'plan.json'));
        this.update(job,{message:`Batch ${Math.floor(batch/3)+1} · rendering Reel ${i+1} of ${candidates.length}`});
        const partial=file+'.partial.mp4';await render(this.runtime,source,plan,partial,clipWork,this.store.settings().quality,this.renderHardware,signal,n=>this.update(job,{progress:62+(i+n)/candidates.length*37}),message=>this.update(job,{fallbacks:[...new Set([...(job.fallbacks||[]),message])],message}));await fs.rename(partial,file);
        job.outputs=job.outputs.filter(r=>r.id!==id);job.outputs.push({id,title:candidates[i].hook.slice(0,100),duration:plan.duration,file,reason:candidates[i].reason,planHash});this.update(job,{outputs:job.outputs});
      }}
      this.update(job,{stage:'completed',progress:100,message:`${job.outputs.length} Reels ready to save`,cleanupAt:this.store.now()+DAY});this.notify(job);
    }catch(error){this.update(job,{stage:signal.aborted?'paused':'failed',cleanupAt:this.store.now()+DAY,message:signal.aborted?'Paused · resume within 24 hours':'Processing needs attention',error:signal.aborted?undefined:String(error instanceof Error?error.message:error).slice(0,1600)});}
    finally{this.active.delete(job.id);this.pump();}
  }
  async processAnime(job:Job){
    const controller=new AbortController();this.active.set(job.id,controller);const signal=controller.signal;const work=this.work(job.id);const output=this.out(job.id);
    const phase=(stage:Stage,progress:number,message:string)=>this.update(job,{stage,checkpoint:stage,progress,message,cleanupAt:undefined});
    try{
      await fs.mkdir(work,{recursive:true});await fs.mkdir(output,{recursive:true});
      phase('importing',4,'Preparing anime episode and music');
      const episodeSource=path.join(work,'episode'+path.extname(job.input.value).toLowerCase());
      if(!await exists(episodeSource)){
        const stat=await fs.stat(job.input.value);const disk=await fs.statfs(work);
        if(Number(disk.bavail)*Number(disk.bsize)<stat.size*2+2e9)throw new Error('Not enough free disk space for episode, working files and edits.');
        await fs.copyFile(job.input.value,episodeSource+'.part');signal.throwIfAborted();await fs.rename(episodeSource+'.part',episodeSource);
      }
      const musicPath=job.input.musicPath||'';
      const musicSource=path.join(work,'music'+path.extname(musicPath).toLowerCase());
      if(musicPath&&!await exists(musicSource)){
        await fs.copyFile(musicPath,musicSource+'.part');signal.throwIfAborted();await fs.rename(musicSource+'.part',musicSource);
      }
      const media=await probe(this.runtime,episodeSource,signal);this.update(job,{duration:media.duration});
      const audio=path.join(work,'audio.wav');
      if(!await exists(audio)){
        await run(path.join(this.runtime,'ffmpeg.exe'),['-y','-i',episodeSource,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',audio+'.part.wav'],{signal});
        await fs.rename(audio+'.part.wav',audio);
      }
      phase('scenes',22,'Detecting anime shots and scene transitions');
      const shotsFile=path.join(work,'shots.json');
      const shots=await this.checkpoint<AnimeShot[]>(shotsFile,d=>Array.isArray(d)&&d.length>0,async()=>{
        await run(path.join(this.runtime,'python/python.exe'),[path.join(this.workers,'anime_worker.py'),'detect-scenes','--input',episodeSource,'--output',shotsFile],{signal,progress:line=>{try{const p=JSON.parse(line);if(Number.isFinite(p.progress))this.update(job,{progress:22+p.progress*26,message:p.message});}catch{}}});
        return JSON.parse(await fs.readFile(shotsFile,'utf8'));
      },fingerprint({episode:await hash(episodeSource),v:1}));
      phase('music',50,'Mapping music beat grid and rhythm dynamics');
      const musicMapFile=path.join(work,'music_map.json');
      const musicMap=await this.checkpoint<MusicMap>(musicMapFile,d=>typeof d==='object'&&Array.isArray(d.beats),async()=>{
        await run(path.join(this.runtime,'python/python.exe'),[path.join(this.workers,'anime_worker.py'),'analyze-music','--input',musicSource,'--output',musicMapFile],{signal,progress:line=>{try{const p=JSON.parse(line);if(Number.isFinite(p.progress))this.update(job,{progress:50+p.progress*22,message:p.message});}catch{}}});
        return JSON.parse(await fs.readFile(musicMapFile,'utf8'));
      },fingerprint({music:await hash(musicSource),v:1}));
      const lang=job.input.language||'ja';
      phase('transcribing',74,`Transcribing dialogue (${lang==='ja'?'Japanese':'English'})`);
      const transcriptFile=path.join(work,'transcript.json');
      const transcript=await this.checkpoint<Transcript>(transcriptFile,d=>d.version===1&&Array.isArray(d.segments),async()=>{
        const transcribeArgs=[path.join(this.workers,'anime_worker.py'),'transcribe','--input',audio,'--output',transcriptFile,'--models',path.join(this.runtime,'models'),'--language',lang];
        if(this.renderHardware.cudaSpeechCandidate)transcribeArgs.push('--gpu');
        await run(path.join(this.runtime,'python/python.exe'),transcribeArgs,{signal,progress:line=>{try{const p=JSON.parse(line);if(Number.isFinite(p.progress))this.update(job,{progress:74+p.progress*12,message:p.message});}catch{}}});
        return JSON.parse(await fs.readFile(transcriptFile,'utf8'));
      },fingerprint({audio:await hash(audio),language:lang,v:1}));
      phase('analyzing',86,'Analyzing motion, audio dynamics and discovering candidate moments');
      const candidatesFile=path.join(work,'candidates.json');
      const candidates=await this.checkpoint<AnimeCandidate[]>(candidatesFile,d=>Array.isArray(d)&&d.length>0,async()=>{
        const candidateArgs=[path.join(this.workers,'anime_worker.py'),'score-candidates','--source',episodeSource,'--shots',shotsFile,'--audio',audio,'--transcript',transcriptFile,'--models',path.join(this.runtime,'models'),'--output',candidatesFile];
        if(this.renderHardware.cudaSpeechCandidate)candidateArgs.push('--gpu');
        await run(path.join(this.runtime,'python/python.exe'),candidateArgs,{signal,progress:line=>{try{const p=JSON.parse(line);if(Number.isFinite(p.progress))this.update(job,{progress:86+p.progress*7,message:p.message});}catch{}}});
        return JSON.parse(await fs.readFile(candidatesFile,'utf8'));
      },fingerprint({shots:await hash(shotsFile),audio:await hash(audio),transcript:await hash(transcriptFile),v:1}));
      phase('analyzing',90,'Selecting 3–5 diverse edit concepts');
      const conceptsFile=path.join(work,'edit_concepts.json');
      const concepts=await this.checkpoint<AnimeEditConcept[]>(conceptsFile,d=>Array.isArray(d)&&d.length>=1,async()=>{
        return selectAnimeMoments(candidates,musicMap,this.store.settings(),p=>this.key(p),signal,message=>this.update(job,{message,provider:message.startsWith('Gemini')?'Gemini':job.provider}));
      },fingerprint({candidates:await hash(candidatesFile),v:1}));
      phase('rendering',92,`Rendering ${concepts.length} vertical 9:16 AMVs`);
      for(let i=0;i<concepts.length;i++){
        signal.throwIfAborted();
        const concept=concepts[i];
        const id=String(concept.id).padStart(2,'0');
        const file=path.join(output,`reelmind_${id}.mp4`);
        const plan=planAnimeEdit(concept,musicMap,shots,30);
        const planHash=fingerprint({plan,quality:this.store.settings().quality});
        const previous=job.outputs.find(r=>r.id===id);
        if(previous?.planHash===planHash&&await exists(file)){
          try{await probe(this.runtime,file,signal);continue;}catch{}
        }
        const clipWork=path.join(work,'amv_'+id);
        await fs.mkdir(clipWork,{recursive:true});
        await atomicJSON(path.join(clipWork,'plan.json'),plan);
        await this.seal(path.join(clipWork,'plan.json'));
        this.update(job,{message:`Rendering AMV ${i+1} of ${concepts.length} · ${concept.title}`});
        const partial=file+'.partial.mp4';
        await renderAnimeAMV(
          this.runtime,
          episodeSource,
          musicPath?musicSource:undefined,
          plan,
          partial,
          clipWork,
          this.store.settings().quality,
          this.renderHardware,
          signal,
          n=>this.update(job,{progress:92+(i+n)/concepts.length*7}),
          message=>this.update(job,{fallbacks:[...new Set([...(job.fallbacks||[]),message])],message})
        );
        await fs.rename(partial,file);
        job.outputs=job.outputs.filter(r=>r.id!==id);
        job.outputs.push({
          id,
          title:concept.title,
          duration:plan.duration,
          file,
          reason:`${concept.category.toUpperCase()} · ${concept.style.replace(/_/g,' ')} (${concept.qualityScore}% match)`,
          planHash
        });
        this.update(job,{outputs:job.outputs});
      }
      const episodeFile=path.join(work,'episode.json');
      const analysis:AnimeEpisodeAnalysis={version:1,metadata:{duration:media.duration,width:media.width,height:media.height,fps:media.fps,videoCodec:media.videoCodec,audioCodec:media.audioCodec},language:lang,shotCount:shots.length,dialogueCount:transcript.segments.length,musicBpm:musicMap.bpm,candidatesCount:candidates.length,candidates:candidates.slice(0,30),conceptsCount:concepts.length,concepts};
      await atomicJSON(episodeFile,analysis);await this.seal(episodeFile);
      this.update(job,{stage:'completed',progress:100,message:`${job.outputs.length} AMV Edits ready to save (${musicMap.bpm} BPM)`,cleanupAt:this.store.now()+DAY,animeAnalysis:{shotCount:shots.length,bpm:musicMap.bpm,beatsCount:musicMap.beats.length,language:lang,candidatesCount:candidates.length,candidates:candidates.slice(0,30),conceptsCount:concepts.length,concepts}});
      this.notify(job);
    }catch(error){
      this.update(job,{stage:signal.aborted?'paused':'failed',cleanupAt:this.store.now()+DAY,message:signal.aborted?'Paused · resume within 24 hours':'Anime analysis needs attention',error:signal.aborted?undefined:String(error instanceof Error?error.message:error).slice(0,1600)});
    }finally{
      this.active.delete(job.id);this.pump();
    }
  }
  async rerenderAnime(id:string,conceptId:number,options:AnimeRerenderOptions={}){
    const job=this.store.get(id);if(!job||job.studio!=='anime')throw new Error('Anime project not found.');
    if(this.active.has(id))throw new Error('Project is currently busy processing.');
    const work=this.work(job.id);const output=this.out(job.id);
    const episodeSource=path.join(work,'episode'+path.extname(job.input.value).toLowerCase());
    if(!await exists(episodeSource))throw new Error('Source episode file is no longer in workspace.');
    const musicPath=job.input.musicPath||'';
    const musicSource=path.join(work,'music'+path.extname(musicPath).toLowerCase());
    const musicMapFile=path.join(work,'music_map.json');
    const shotsFile=path.join(work,'shots.json');
    const conceptsFile=path.join(work,'edit_concepts.json');
    if(!await exists(conceptsFile)||!await exists(musicMapFile)||!await exists(shotsFile)){
      throw new Error('Analysis data files missing for this project.');
    }
    const musicMap:MusicMap=JSON.parse(await fs.readFile(musicMapFile,'utf8'));
    const shots:AnimeShot[]=JSON.parse(await fs.readFile(shotsFile,'utf8'));
    const concepts:AnimeEditConcept[]=JSON.parse(await fs.readFile(conceptsFile,'utf8'));
    const concept=concepts.find(c=>c.id===conceptId);
    if(!concept)throw new Error(`AMV Concept #${conceptId} not found.`);

    if(options.style){
      concept.style=options.style;
      await atomicJSON(conceptsFile, concepts);
      if(job.animeAnalysis?.concepts){
        const jc=job.animeAnalysis.concepts.find(c=>c.id===conceptId);
        if(jc)jc.style=options.style;
      }
    }
    const plan=planAnimeEdit(concept,musicMap,shots,30);
    if(options.sourceAudioMix!==undefined){
      plan.audio.sourceAudioMix=Math.max(0,Math.min(1,options.sourceAudioMix));
    }
    if(options.musicMix!==undefined){
      plan.audio.musicMix=Math.max(0,Math.min(1,options.musicMix));
    }

    const controller=new AbortController();this.active.set(job.id,controller);const signal=controller.signal;
    const clipId=String(concept.id).padStart(2,'0');const file=path.join(output,`reelmind_${clipId}.mp4`);
    const planHash=fingerprint({plan,quality:this.store.settings().quality,opts:options});
    const clipWork=path.join(work,'amv_'+clipId);
    await fs.mkdir(clipWork,{recursive:true});
    await atomicJSON(path.join(clipWork,'plan.json'),plan);await this.seal(path.join(clipWork,'plan.json'));

    this.update(job,{message:`Re-rendering AMV ${concept.id} · ${concept.title} (${concept.style.replace(/_/g,' ')})`});
    try{
      const partial=file+'.partial.mp4';
      await renderAnimeAMV(
        this.runtime,
        episodeSource,
        musicPath?musicSource:undefined,
        plan,
        partial,
        clipWork,
        this.store.settings().quality,
        this.renderHardware,
        signal,
        progress=>this.update(job,{message:`Re-rendering AMV ${concept.id} · ${Math.floor(progress*100)}%`}),
        message=>this.update(job,{fallbacks:[...new Set([...(job.fallbacks||[]),message])],message})
      );
      await fs.rename(partial,file);
      job.outputs=job.outputs.filter(r=>r.id!==clipId);
      job.outputs.push({
        id:clipId,
        title:concept.title,
        duration:plan.duration,
        file,
        reason:`${concept.category.toUpperCase()} · ${concept.style.replace(/_/g,' ')} (${concept.qualityScore}% match)`,
        planHash
      });
      job.outputs.sort((a,b)=>a.id.localeCompare(b.id));
      this.update(job,{message:`AMV ${concept.id} re-rendered with ${concept.style.replace(/_/g,' ')}`,outputs:job.outputs,animeAnalysis:job.animeAnalysis});
      this.notify(job);
    }finally{
      this.active.delete(job.id);
      this.pump();
    }
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
