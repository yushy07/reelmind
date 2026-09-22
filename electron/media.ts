import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './process';
import type { EditPlan } from '../shared/types';
export async function probe(runtime:string,file:string,signal?:AbortSignal){
  const data=JSON.parse(await run(path.join(runtime,'ffprobe.exe'),['-v','error','-show_format','-show_streams','-of','json',file],{signal}));
  const video=data.streams?.find((s:any)=>s.codec_type==='video'),audio=data.streams?.find((s:any)=>s.codec_type==='audio');
  const duration=Number(data.format?.duration);
  if(!video||!audio||!Number.isFinite(duration)||duration<30)throw new Error('The video needs a readable picture, audio and at least 30 seconds of content.');
  const [numerator,denominator]=String(video.avg_frame_rate||video.r_frame_rate||'30/1').split('/').map(Number);const fps=denominator?numerator/denominator:30;
  return {duration,width:Number(video.width),height:Number(video.height),videoCodec:video.codec_name,audioCodec:audio.codec_name,fps:Number.isFinite(fps)?fps:30};
}
export async function render(runtime:string,source:string,plan:EditPlan,output:string,work:string,quality:string,hardware:{nvenc:boolean;cpuThreads:number},signal:AbortSignal,report:(n:number)=>void,fallback?:(message:string)=>void){
  const subtitle=path.join(work,'captions.ass');await fs.writeFile(subtitle,plan.captions.replaceAll('Noto Sans JP','Noto Sans CJK JP'));
  const origin=plan.candidate.start;
  const inputCuts=plan.cuts.map((c,i)=>`[0:v]trim=start=${c.start-origin}:end=${c.end-origin},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=start=${c.start-origin}:end=${c.end-origin},asetpts=PTS-STARTPTS[a${i}]`);
  const join=plan.cuts.map((_,i)=>`[v${i}][a${i}]`).join('')+`concat=n=${plan.cuts.length}:v=1:a=1[base][audio]`;
  const shots=plan.shots;
  // Shared source branches are explicitly split so the filter graph stays valid.
  const split=`[base]split=${shots.length}${shots.map((_,i)=>`[s${i}]`).join('')}`;
  const graphs=shots.map((shot,i)=>{
    const trim=`[s${i}]trim=start=${shot.start}:end=${shot.end},setpts=PTS-STARTPTS`;
    if(shot.layout==='fit')return `${trim},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x12111b,setsar=1,fps=${plan.fps}[o${i}]`;
    if(shot.layout==='split'&&shot.centers?.length===2){return `${trim},split=2[top${i}][bottom${i}];[top${i}]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960:x='max(0,min(iw-ow,iw*${shot.centers[0]}-ow/2))':y='max(0,(ih-oh)*0.25)'[ta${i}];[bottom${i}]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960:x='max(0,min(iw-ow,iw*${shot.centers[1]}-ow/2))':y='max(0,(ih-oh)*0.25)'[ba${i}];[ta${i}][ba${i}]vstack=inputs=2,setsar=1,fps=${plan.fps}[o${i}]`;}
    const travel=shot.endCenter-shot.center,duration=Math.max(.1,shot.end-shot.start);const center=`${shot.center}+(${travel})*(0.5-0.5*cos(PI*min(t/${duration},1)))`;
    return `${trim},scale=${Math.ceil(1080*shot.zoom/2)*2}:${Math.ceil(1920*shot.zoom/2)*2}:force_original_aspect_ratio=increase,crop=1080:1920:x='max(0,min(iw-ow,iw*(${center})-ow/2))':y='max(0,(ih-oh)*0.3)',setsar=1,fps=${plan.fps}[o${i}]`;
  });
  const escapedFonts=path.join(runtime,'fonts').replaceAll('\\','/').replace(':','\\:').replaceAll("'","\\'");
  const final=shots.map((_,i)=>`[o${i}]`).join('')+`concat=n=${shots.length}:v=1:a=0,ass=filename='captions.ass':fontsdir='${escapedFonts}',format=yuv420p[out];[audio]highpass=f=70,afftdn=nf=-28,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  const graph=[...inputCuts,join,split,...graphs,final].join(';\n');
  await fs.writeFile(path.join(work,'render.ffscript'),graph);
  const base=['-hide_banner','-y','-filter_complex_threads',String(hardware.cpuThreads),'-ss',String(origin),'-t',String(plan.candidate.end-origin),'-i',source,'-filter_complex',graph,'-map','[out]','-map','[aout]','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-progress','pipe:1','-nostats'];
  const encode=async(args:string[])=>run(path.join(runtime,'ffmpeg.exe'),[...base,...args,output],{cwd:work,signal,progress:line=>{if(line.startsWith('out_time_us='))report(Math.min(.99,Number(line.slice(12))/1e6/plan.duration));}});
  try{if(!hardware.nvenc)throw new Error('NVENC not selected');await encode(['-c:v','h264_nvenc','-preset','p4','-cq',quality==='high'?'19':'23']);}
  catch{signal.throwIfAborted();fallback?.('GPU encoding unavailable; using software H.264');try{await encode(['-c:v','libopenh264','-b:v',quality==='high'?'10M':'7M','-maxrate',quality==='high'?'14M':'10M','-bufsize','20M','-threads',String(hardware.cpuThreads)]);}catch{signal.throwIfAborted();fallback?.('Software encoder unavailable; trying Windows H.264');await encode(['-c:v','h264_mf','-b:v',quality==='high'?'10M':'7M']);}}
  const metadata=await probe(runtime,output,signal);
  if(metadata.width!==1080||metadata.height!==1920||metadata.videoCodec!=='h264'||metadata.audioCodec!=='aac'||metadata.duration<29.9||metadata.duration>60.2)throw new Error('Rendered Reel failed export validation.');
}
