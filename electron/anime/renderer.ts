import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../process';
import { probe } from '../media';
import type { AnimeEditPlan } from '../../shared/types';

/**
 * Builds the complete FFmpeg filter_complex string for an AMV edit.
 * Trims shots, reframes to 9:16 portrait, applies camera punch/flash dynamics,
 * and mixes episode audio with the background music track.
 */
export function buildAnimeFilterGraph(
  plan: AnimeEditPlan,
  hasMusic = true,
  runtime?: string,
  audioIndex = 0
): string {
  const cuts = plan.cuts;
  const videoTrims: string[] = [];
  const audioTrims: string[] = [];

  const aspect = plan.aspectRatio || '9:16';
  const targetW = aspect === '16:9' ? 1920 : 1080;
  const targetH = aspect === '16:9' ? 1080 : (aspect === '1:1' ? 1080 : 1920);

  cuts.forEach((cut, i) => {
    const dur = Math.max(0.1, cut.duration);
    const scaledW = Math.ceil(targetW * cut.zoom / 2) * 2;
    const scaledH = Math.ceil(targetH * cut.zoom / 2) * 2;
    const travel = cut.endCenter - cut.center;
    const centerExpr = `${cut.center}+(${travel})*(0.5-0.5*cos(PI*min(t/${dur},1)))`;

    // Dynamic camera crop & jitter on shake
    let cropX = `max(0,min(iw-ow,iw*(${centerExpr})-ow/2))`;
    let cropY = `max(0,(ih-oh)*0.3)`;
    if (cut.effect === 'shake') {
      cropX = `max(0,min(iw-ow,iw*(${centerExpr})-ow/2+if(lt(t,0.22),sin(t*80)*8,0)))`;
      cropY = `max(0,(ih-oh)*0.3+if(lt(t,0.22),cos(t*80)*8,0))`;
    }

    let ptsExpr = 'PTS-STARTPTS';
    let temporalFilter = '';
    if (cut.velocityCurve === 'slow_motion') {
      ptsExpr = '1.75*(PTS-STARTPTS)';
      temporalFilter = ',tblend=all_mode=average';
    } else if (cut.velocityCurve === 'impact_ramp') {
      ptsExpr = '0.65*(PTS-STARTPTS)';
      temporalFilter = ',tblend=all_mode=average';
    } else if (cut.velocityCurve === 'ease_in_out') {
      ptsExpr = '0.85*(PTS-STARTPTS)';
    }

    let filterChain = `[0:v]trim=start=${cut.sourceStart}:end=${cut.sourceEnd},setpts=${ptsExpr}${temporalFilter}`;
    filterChain += `,scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}:x='${cropX}':y='${cropY}'`;

    if (cut.isolateCharacter) {
      filterChain += `,split=2[bg_raw${i}][fg_raw${i}];[bg_raw${i}]gblur=sigma=12:steps=2[bg_blur${i}];[fg_raw${i}]vibrance=intensity=0.5,vignette=angle=PI/3.5[fg_vig${i}];[bg_blur${i}][fg_vig${i}]blend=all_mode=screen:all_opacity=0.6`;
    }

    // Style effects (white flash on drop using exposure, color saturation on glow using vibrance)
    if (cut.effect === 'flash') {
      filterChain += `,exposure=exposure=1.5:enable='lt(t,0.18)'`;
    } else if (cut.effect === 'glow' && !cut.isolateCharacter) {
      filterChain += `,vibrance=intensity=0.45`;
    }

    filterChain += `,setsar=1,fps=${plan.fps}[v${i}]`;
    videoTrims.push(filterChain);

    // Audio trim for this shot cut with standardized sample rate and channels
    let audioSpeed = '';
    if (cut.velocityCurve === 'slow_motion') {
      audioSpeed = ',atempo=0.57';
    } else if (cut.velocityCurve === 'impact_ramp') {
      audioSpeed = ',atempo=1.54';
    }
    const audioSelector = audioIndex > 0 ? `[0:a:${audioIndex}]` : '[0:a]';
    audioTrims.push(`${audioSelector}atrim=start=${cut.sourceStart}:end=${cut.sourceEnd},asetpts=PTS-STARTPTS${audioSpeed},aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`);
  });

  // Video stream concatenation
  const vconcatInputs = cuts.map((_, i) => `[v${i}]`).join('');
  let vconcat: string;
  if (plan.captions && runtime) {
    const escapedFonts = path.join(runtime, 'fonts').replaceAll('\\', '/').replace(':', '\\:').replaceAll("'", "\\'");
    vconcat = `${vconcatInputs}concat=n=${cuts.length}:v=1:a=0,ass=filename='captions.ass':fontsdir='${escapedFonts}',format=yuv420p[vout]`;
  } else {
    vconcat = `${vconcatInputs}concat=n=${cuts.length}:v=1:a=0,format=yuv420p[vout]`;
  }

  // Episode audio concatenation
  const aconcatInputs = cuts.map((_, i) => `[a${i}]`).join('');
  const aconcat = `${aconcatInputs}concat=n=${cuts.length}:v=0:a=1,volume=${plan.audio.sourceAudioMix}[aepisode]`;

  let finalAudio: string;
  if (hasMusic) {
    const musicTrim = `[1:a]atrim=start=${plan.audio.musicOffset}:end=${plan.audio.musicOffset + plan.duration},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${plan.audio.musicMix}[amusic]`;
    const amix = `[aepisode][amusic]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-14:TP=-1.0:LRA=9[aout]`;
    return [...videoTrims, ...audioTrims, vconcat, aconcat, musicTrim, amix].join(';\n');
  } else {
    finalAudio = `[aepisode]loudnorm=I=-14:TP=-1.0:LRA=9[aout]`;
    return [...videoTrims, ...audioTrims, vconcat, aconcat, finalAudio].join(';\n');
  }
}

/**
 * Renders an AMV clip using NVENC GPU acceleration
 * with graceful CPU fallbacks and technical validation.
 */
export async function renderAnimeAMV(
  runtime: string,
  sourceVideo: string,
  sourceMusic: string | undefined,
  plan: AnimeEditPlan,
  outputMp4: string,
  workDir: string,
  quality: string,
  hardware: { nvenc: boolean; cpuThreads: number },
  signal: AbortSignal,
  report: (progress: number) => void,
  fallback?: (message: string) => void,
  audioIndex = 0
): Promise<void> {
  const hasMusic = !!sourceMusic && (await fs.stat(sourceMusic).catch(() => null)) !== null;

  if (plan.captions) {
    const subtitle = path.join(workDir, 'captions.ass');
    await fs.writeFile(subtitle, plan.captions.replaceAll('Noto Sans JP', 'Noto Sans CJK JP'));
  }

  const graph = buildAnimeFilterGraph(plan, hasMusic, runtime, audioIndex);

  const graphScript = path.join(workDir, `render_amv_${plan.conceptId}.ffscript`);
  await fs.writeFile(graphScript, graph);

  const baseArgs = [
    '-hide_banner',
    '-y',
    '-filter_complex_threads', String(hardware.cpuThreads),
    '-i', sourceVideo
  ];

  if (hasMusic) {
    baseArgs.push('-i', sourceMusic!);
  }

  baseArgs.push(
    '-filter_complex', graph,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats'
  );

  const encode = async (codecArgs: string[]) =>
    run(path.join(runtime, 'ffmpeg.exe'), [...baseArgs, ...codecArgs, outputMp4], {
      cwd: workDir,
      signal,
      progress: line => {
        if (line.startsWith('out_time_us=')) {
          const currentSec = Number(line.slice(12)) / 1e6;
          report(Math.min(0.99, currentSec / plan.duration));
        }
      }
    });

  // 1. Attempt hardware-accelerated NVENC encoding
  let rendered = false;
  if (hardware.nvenc) {
    try {
      await encode([
        '-c:v', 'h264_nvenc',
        '-preset', quality === 'high' ? 'p5' : 'p4',
        '-cq', quality === 'high' ? '17' : '22',
        '-b:v', quality === 'high' ? '14M' : '8M',
        '-maxrate', quality === 'high' ? '18M' : '10M',
        '-bufsize', quality === 'high' ? '25M' : '15M',
        '-pix_fmt', 'yuv420p'
      ]);
      rendered = true;
    } catch {
      signal.throwIfAborted();
      fallback?.('GPU NVENC encoding unavailable; using CPU H.264');
    }
  }

  // 2. Fallback to openh264
  if (!rendered) {
    try {
      await encode([
        '-c:v', 'libopenh264',
        '-b:v', quality === 'high' ? '12M' : '8M',
        '-maxrate', quality === 'high' ? '16M' : '11M',
        '-bufsize', '20M',
        '-threads', String(hardware.cpuThreads),
        '-pix_fmt', 'yuv420p'
      ]);
      rendered = true;
    } catch {
      signal.throwIfAborted();
      fallback?.('Software encoder unavailable; trying Windows Media Foundation');
    }
  }

  // 3. Fallback to Windows Media Foundation h264_mf
  if (!rendered) {
    await encode([
      '-c:v', 'h264_mf',
      '-b:v', quality === 'high' ? '12M' : '8M',
      '-pix_fmt', 'yuv420p'
    ]);
  }

  // 4. Strict Quality Control Validation
  const expectedW = plan.aspectRatio === '16:9' ? 1920 : 1080;
  const expectedH = plan.aspectRatio === '16:9' ? 1080 : (plan.aspectRatio === '1:1' ? 1080 : 1920);
  const metadata = await probe(runtime, outputMp4, signal, 1.0);
  if (
    metadata.width !== expectedW ||
    metadata.height !== expectedH ||
    metadata.videoCodec !== 'h264' ||
    metadata.audioCodec !== 'aac' ||
    metadata.duration < 2.0
  ) {
    throw new Error(
      `Rendered AMV failed quality control: ${metadata.width}x${metadata.height}, ${metadata.videoCodec}, ${metadata.duration}s (expected ${expectedW}x${expectedH})`
    );
  }
}
