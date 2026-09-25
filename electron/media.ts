import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './process';
import type { EditPlan } from '../shared/types';

export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(':', '\\:').replaceAll("'", "\\'");
}
export async function probe(runtime:string,file:string,signal?:AbortSignal,minDuration=25){
  const data=JSON.parse(await run(path.join(runtime,'ffprobe.exe'),['-v','error','-show_format','-show_streams','-of','json',file],{signal}));
  const video=data.streams?.find((s:any)=>s.codec_type==='video'),audio=data.streams?.find((s:any)=>s.codec_type==='audio');
  const duration=Number(data.format?.duration);
  if(!video||!audio||!Number.isFinite(duration)||duration<minDuration)throw new Error(`The video needs a readable picture, audio and at least ${minDuration} seconds of content.`);
  const [numerator,denominator]=String(video.avg_frame_rate||video.r_frame_rate||'30/1').split('/').map(Number);const fps=denominator?numerator/denominator:30;
  const audioStreams=(data.streams||[]).filter((s:any)=>s.codec_type==='audio').map((s:any,idx:number)=>({index:idx,streamIndex:Number(s.index),language:String(s.tags?.language||s.tags?.LANG||'').toLowerCase(),title:String(s.tags?.title||'')}));
  return {duration,width:Number(video.width),height:Number(video.height),videoCodec:video.codec_name,audioCodec:audio.codec_name,fps:Number.isFinite(fps)?fps:30,audioStreams};
}
export async function render(runtime:string,source:string,plan:EditPlan,output:string,work:string,quality:string,hardware:{nvenc:boolean;cpuThreads:number;nvdec?:boolean},signal:AbortSignal,report:(n:number)=>void,fallback?:(message:string)=>void){
  const subtitle=path.join(work,'captions.ass');
  const ffscript=path.join(work,'render.ffscript');
  try {
    await fs.writeFile(subtitle,plan.captions.replaceAll('Noto Sans JP','Noto Sans CJK JP'));
    const origin=plan.candidate.start;
    const inputCuts=plan.cuts.map((c,i)=>`[0:v]trim=start=${c.start-origin}:end=${c.end-origin},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=start=${c.start-origin}:end=${c.end-origin},asetpts=PTS-STARTPTS[a${i}]`);
    const join=plan.cuts.map((_,i)=>`[v${i}][a${i}]`).join('')+`concat=n=${plan.cuts.length}:v=1:a=1[base][audio]`;
    const shots=plan.shots;
    // Shared source branches are explicitly split so the filter graph stays valid.
    const split=`[base]split=${shots.length}${shots.map((_,i)=>`[s${i}]`).join('')}`;
    const graphs=shots.map((shot,i)=>{
      const trim=`[s${i}]trim=start=${shot.start}:end=${shot.end},setpts=PTS-STARTPTS`;
      if(shot.layout==='fit')return `${trim},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x12111b,setsar=1,fps=${plan.fps}[o${i}]`;
      if(shot.layout==='split'&&shot.centers?.length===2){
        const c0 = Number.isFinite(shot.centers[0]) ? Math.max(0, Math.min(1, shot.centers[0])) : 0.5;
        const c1 = Number.isFinite(shot.centers[1]) ? Math.max(0, Math.min(1, shot.centers[1])) : 0.5;
        return `${trim},split=2[top${i}][bottom${i}];[top${i}]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960:x='max(0,min(iw-ow,iw*${c0}-ow/2))':y='max(0,(ih-oh)*0.25)'[ta${i}];[bottom${i}]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960:x='max(0,min(iw-ow,iw*${c1}-ow/2))':y='max(0,(ih-oh)*0.25)'[ba${i}];[ta${i}][ba${i}]vstack=inputs=2,setsar=1,fps=${plan.fps}[o${i}]`;
      }
      const c = Number.isFinite(shot.center) ? Math.max(0, Math.min(1, shot.center)) : 0.5;
      const ec = Number.isFinite(shot.endCenter) ? Math.max(0, Math.min(1, shot.endCenter)) : c;
      const zoom = Number.isFinite(shot.zoom) ? Math.max(1, Math.min(3, shot.zoom)) : 1.0;
      const duration = Math.max(.1, Number.isFinite(shot.end - shot.start) ? shot.end - shot.start : .1);
      const travel = ec - c;
      const center=`${c}+(${travel})*(0.5-0.5*cos(PI*min(t/${duration},1)))`;
      return `${trim},scale=${Math.ceil(1080*zoom/2)*2}:${Math.ceil(1920*zoom/2)*2}:force_original_aspect_ratio=increase,crop=1080:1920:x='max(0,min(iw-ow,iw*(${center})-ow/2))':y='max(0,(ih-oh)*0.3)',setsar=1,fps=${plan.fps}[o${i}]`;
    });
    const escapedFonts = escapeFfmpegFilterPath(path.join(runtime, 'fonts'));
    const final=shots.map((_,i)=>`[o${i}]`).join('')+`concat=n=${shots.length}:v=1:a=0,ass=filename='captions.ass':fontsdir='${escapedFonts}',format=yuv420p[out];[audio]highpass=f=70,afftdn=nf=-28,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    const graph=[...inputCuts,join,split,...graphs,final].join(';\n');
    await fs.writeFile(ffscript,graph);

    const buildBase = (hwaccel: boolean) => [
      '-hide_banner',
      '-y',
      '-filter_complex_threads', String(hardware.cpuThreads),
      ...(hwaccel ? ['-hwaccel', 'cuda'] : []),
      '-ss', String(origin),
      '-t', String(plan.candidate.end - origin),
      '-i', source,
      '-filter_complex', graph,
      '-map', '[out]',
      '-map', '[aout]',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      '-nostats'
    ];
    const encode=async(args:string[], hwaccel=false)=>run(path.join(runtime,'ffmpeg.exe'),[...buildBase(hwaccel),...args,output],{cwd:work,signal,progress:line=>{if(line.startsWith('out_time_us='))report(Math.min(.99,Number(line.slice(12))/1e6/plan.duration));}});

    let rendered = false;
    if (hardware.nvenc) {
      const canHwaccel = hardware.nvdec !== false;
      try {
        await encode(['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', quality === 'high' ? '19' : '23'], canHwaccel);
        rendered = true;
      } catch {
        signal.throwIfAborted();
        if (canHwaccel) {
          try {
            await encode(['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', quality === 'high' ? '19' : '23'], false);
            rendered = true;
          } catch {
            signal.throwIfAborted();
          }
        }
      }
    }
    if (!rendered) {
      fallback?.('GPU encoding unavailable; using software H.264');
      try {
        await encode(['-c:v', 'libopenh264', '-b:v', quality === 'high' ? '10M' : '7M', '-maxrate', quality === 'high' ? '14M' : '10M', '-bufsize', '20M', '-threads', String(hardware.cpuThreads)], false);
      } catch {
        signal.throwIfAborted();
        fallback?.('Software encoder unavailable; trying Windows H.264');
        await encode(['-c:v', 'h264_mf', '-b:v', quality === 'high' ? '10M' : '7M'], false);
      }
    }
    const metadata=await probe(runtime,output,signal,24.8);
    if(metadata.width!==1080||metadata.height!==1920||metadata.videoCodec!=='h264'||metadata.audioCodec!=='aac'||metadata.duration<24.8||metadata.duration>95.0)throw new Error(`Rendered Reel failed export validation: ${metadata.duration.toFixed(2)}s (expected at least 25s)`);
  } finally {
    if (signal?.aborted) {
      await fs.unlink(subtitle).catch(()=>{});
      await fs.unlink(ffscript).catch(()=>{});
      await fs.unlink(output).catch(()=>{});
    }
  }
}

