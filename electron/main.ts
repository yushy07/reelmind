import { app, BrowserWindow, ipcMain, dialog, Notification, protocol, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Store } from './storage';
import { Service } from './service';
import { settingsSchema } from './core';
import { run } from './process';
import { z } from 'zod';
import type { CreateInput, Provider, Status } from '../shared/types';
protocol.registerSchemesAsPrivileged([{scheme:'reel',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,bypassCSP:false}}]);
const selfTest=process.argv.includes('--self-test');
if(selfTest)app.setPath('userData',path.join(app.getPath('temp'),'reelmind-check-'+process.pid));
let window:BrowserWindow;let service:Service;let closing=false;
const setup:Status['setup']={running:false,message:''};
const keyPresence:Record<Provider,boolean>={gemini:false,openrouter:false};
let hardware='Checking hardware…';
function changed(){if(window&&!window.isDestroyed()){
  const active=service?.store.jobs().find(job=>['importing','transcribing','framing','analyzing','rendering'].includes(job.stage));
  window.setProgressBar(active?Math.max(.01,Math.min(.99,active.progress/100)):service?.models.state.running?Math.max(.01,Math.min(.99,service.models.state.downloaded/service.models.state.total)):-1);
  window.webContents.send('changed');
}}
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{window?.show();window?.focus();});
app.whenReady().then(async()=>{
  app.setAppUserModelId('studio.reelmind.desktop');
  const base=app.isPackaged?process.resourcesPath:app.getAppPath();
  const root=app.getPath('userData');await fs.mkdir(root,{recursive:true});
  const store=new Store(path.join(root,'reelmind.sqlite'));
  service=new Service(root,path.join(base,'runtime'),path.join(base,'workers'),store,changed,job=>{
    if(Notification.isSupported()){const notification=new Notification({title:job.outputs.length?'Your Reels are ready':'Analysis complete',body:job.message});notification.on('click',()=>{window.show();window.focus();window.webContents.send('open-project',job.id);});notification.show();}
    if(window?.isFocused())window.webContents.send('open-project',job.id);
  });
  protocol.handle('reel',async request=>{
    const url=new URL(request.url);const [jobId,reelId]=url.pathname.split('/').filter(Boolean);const job=store.get(jobId);const reel=job?.outputs.find(r=>r.id===reelId);
    if(url.hostname!=='output'||!reel)return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(reel.savedPath||reel.file).toString(),{headers:request.headers});
  });
  const smoke=selfTest||!app.isPackaged&&process.env.REELMIND_SMOKE==='1';
  window=new BrowserWindow({width:1400,height:940,minWidth:1000,minHeight:740,show:!smoke,backgroundColor:'#101015',title:'REELMIND',icon:path.join(app.getAppPath(),'assets/icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:smoke}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  const handle=(name:string,fn:(...args:any[])=>any)=>ipcMain.handle(name,(event,...args)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Untrusted request');return fn(...args);});
  handle('status',async()=>({jobs:store.jobs(),settings:store.settings(),keys:keyPresence,runtime:await service.readiness(),hardware,setup,turbo:service.models.state} satisfies Status));
  handle('pick-video',async()=>{const result=await dialog.showOpenDialog(window,{title:'Choose a video',properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mov','mkv','avi','webm']}]});const file=result.filePaths[0];if(result.canceled||!file)return null;service.allowedInputs.add(file);return file;});
  handle('pick-audio',async()=>{const result=await dialog.showOpenDialog(window,{title:'Choose a music track',properties:['openFile'],filters:[{name:'Audio',extensions:['mp3','wav','aac','flac','m4a','ogg']}]});const file=result.filePaths[0];if(result.canceled||!file)return null;service.allowedInputs.add(file);return file;});
  handle('create',async input=>service.create(z.object({kind:z.enum(['local','url']),value:z.string().min(1).max(4096),name:z.string().trim().max(80).optional(),pastedTranscript:z.string().max(200_000).optional()}).strict().parse(input) as CreateInput));
  handle('create-anime',async input=>service.createAnime(z.object({kind:z.literal('local'),episodePath:z.string().min(1).max(4096),musicPath:z.string().min(1).max(4096),language:z.enum(['ja','en']),name:z.string().trim().max(80).optional(),outputAspect:z.enum(['9:16','16:9','1:1']).optional()}).strict().parse(input)));
  handle('rerender-anime',async(jobId,conceptId,options)=>service.rerenderAnime(
    z.string().uuid().parse(jobId),
    z.number().int().min(1).parse(conceptId),
    z.object({
      style:z.enum(['hard_beat_drop','slow_burn','dialogue_pause','velocity_ramp']).optional(),
      sourceAudioMix:z.number().min(0).max(1).optional(),
      musicMix:z.number().min(0).max(1).optional()
    }).strict().parse(options||{})
  ));
  handle('action',async(id,action)=>{z.string().uuid().parse(id);z.enum(['pause','resume','delete']).parse(action);if(action==='delete'){const answer=await dialog.showMessageBox(window,{type:'warning',message:'Delete this project and any unsaved Reels?',detail:'Original videos and Reels already saved outside REELMIND will stay untouched.',buttons:['Keep project','Delete'],defaultId:0,cancelId:0});if(answer.response!==1)return;}await service.action(id,action);});
  handle('save',async id=>{z.string().uuid().parse(id);const result=await dialog.showOpenDialog(window,{title:'Save Reels outside REELMIND',properties:['openDirectory','createDirectory']});if(result.canceled)return null;return service.save(id,result.filePaths[0],[root,app.getAppPath(),path.dirname(process.execPath),app.getPath('sessionData')]);});
  handle('settings',async(settings,keys)=>{const next=settingsSchema.parse(settings);if(next.transcriptionMode==='turbo'&&!service.models.state.ready)throw new Error('Download and verify Turbo before selecting it.');const parsed=z.object({gemini:z.string().max(4096).optional(),openrouter:z.string().max(4096).optional()}).strict().parse(keys);for(const p of ['gemini','openrouter'] as const){if(parsed[p]!==undefined){await service.setKey(p,parsed[p]!);keyPresence[p]=!!parsed[p];}}store.setSettings(next);changed();});
  handle('setup',async()=>{
    if(setup.running)return;
    if(app.isPackaged)throw new Error('The packaged local engine is incomplete. Reinstall REELMIND from a complete installer.');
    setup.running=true;setup.error=undefined;setup.message='Downloading local engine and models…';changed();
    void run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(base,'scripts/setup-runtime.ps1')],{progress:line=>{setup.message=line.slice(-200);changed();}}).then(()=>{setup.message='Local engine ready';}).catch(e=>{setup.error=e.message;}).finally(()=>{setup.running=false;changed();});
  });
  await service.models.init();
  await service.models.cleanup(store.now());
  handle('turbo',async action=>{z.enum(['download','cancel']).parse(action);if(action==='download')service.models.start();else service.models.cancel();});
  await service.init();
  if(!selfTest)for(const p of ['gemini','openrouter'] as const)keyPresence[p]=!!await service.key(p).catch(()=>'');
  try{const value=await run('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader,nounits']);const fields=value.trim().split(',');const vram=Number(fields.at(-1)?.trim()||0);service.configureHardware(vram);hardware=`${fields.slice(0,-1).join(',').trim()} · ${Math.round(vram/1024)} GB VRAM · ${vram>=2048?'NVENC enabled':'CPU encoding'}`;}catch{hardware='CPU encoding available · NVIDIA GPU not detected';}changed();
  setInterval(()=>{void service.cleanup().catch(()=>{});void service.models.cleanup(store.now()).catch(()=>{});},60_000).unref();
  if(process.env.REELMIND_DEV_URL&&!app.isPackaged)await window.loadURL('http://127.0.0.1:5173');else await window.loadFile(path.join(app.getAppPath(),'dist/index.html'));
  if(selfTest){
    try{await new Promise(r=>setTimeout(r,1000));const state=await service.readiness();if(!state.ready)throw new Error('Packaged runtime incomplete: '+state.missing.join(', '));await run(path.join(service.runtime,'python/python.exe'),['-c','import faster_whisper, sherpa_onnx, cv2; print("workers ready")']);const content=await window.webContents.executeJavaScript('document.body.innerText');if(!content.includes('Great little moments.'))throw new Error('Packaged renderer did not load');console.log(JSON.stringify({packaged:app.isPackaged,renderer:true,runtime:true,workers:true}));app.quit();}catch(error){console.error(error);app.exit(1);}
  }
});
app.on('before-quit',event=>{if(service&&!closing){event.preventDefault();closing=true;service.models.cancel();void Promise.all([service.shutdown(),service.models.task]).finally(()=>app.quit());}});
app.on('window-all-closed',()=>app.quit());
