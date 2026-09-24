import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, cleanupTemps, hash } from '../storage';
import { DAY } from '../core';
import { run } from '../process';
import { probe } from '../media';
import { selectAnimeMoments } from '../anime/selection';
import { planAnimeEdit } from '../anime/planner';
import { renderAnimeAMV } from '../anime/renderer';
import type {
  Job,
  Stage,
  Transcript,
  AnimeShot,
  MusicMap,
  AnimeEpisodeAnalysis,
  AnimeCandidate,
  AnimeEditConcept,
  AnimeRerenderOptions,
} from '../../shared/types';
import type { PipelineContext } from './base';

const exists = async (file: string) => !!await fs.stat(file).catch(() => null);

export class AnimePipeline {
  constructor(private ctx: PipelineContext) {}

  async process(job: Job, signal: AbortSignal): Promise<void> {
    const work = this.ctx.work(job.id);
    const output = this.ctx.out(job.id);
    const phase = (stage: Stage, progress: number, message: string) =>
      this.ctx.update(job, { stage, checkpoint: stage, progress, message, cleanupAt: undefined });

    try {
      await fs.mkdir(work, { recursive: true });
      await fs.mkdir(output, { recursive: true });
      phase('importing', 4, 'Preparing anime episode and music');
      const episodeSource = path.join(work, 'episode' + path.extname(job.input.value).toLowerCase());
      if (!await exists(episodeSource)) {
        const stat = await fs.stat(job.input.value);
        const disk = await fs.statfs(work);
        if (Number(disk.bavail) * Number(disk.bsize) < stat.size * 2 + 2e9) {
          throw new Error('Not enough free disk space for episode, working files and edits.');
        }
        await fs.copyFile(job.input.value, episodeSource + '.part');
        signal.throwIfAborted();
        await fs.rename(episodeSource + '.part', episodeSource);
      }
      const musicPath = job.input.musicPath || '';
      const musicSource = path.join(work, 'music' + path.extname(musicPath).toLowerCase());
      if (musicPath && !await exists(musicSource)) {
        await fs.copyFile(musicPath, musicSource + '.part');
        signal.throwIfAborted();
        await fs.rename(musicSource + '.part', musicSource);
      }
      const media = await probe(this.ctx.runtime, episodeSource, signal);
      this.ctx.update(job, { duration: media.duration });
      const lang = job.input.language || 'ja';
      let selectedAudioIdx = 0;
      if (media.audioStreams && media.audioStreams.length > 1) {
        const match = media.audioStreams.find((s: { index: number; streamIndex: number; language: string; title: string }) =>
          lang === 'ja'
            ? s.language.includes('ja') || s.language.includes('jpn') || s.title.toLowerCase().includes('jap')
            : s.language.includes('en') || s.language.includes('eng') || s.title.toLowerCase().includes('eng')
        );
        if (match) selectedAudioIdx = match.index;
      }
      const audio = path.join(work, 'audio.wav');
      if (!await exists(audio)) {
        await run(
          path.join(this.ctx.runtime, 'ffmpeg.exe'),
          ['-y', '-i', episodeSource, '-map', `0:a:${selectedAudioIdx}`, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio + '.part.wav'],
          { signal }
        );
        await fs.rename(audio + '.part.wav', audio);
      }
      phase('scenes', 22, 'Detecting anime shots and scene transitions');
      const shotsFile = path.join(work, 'shots.json');
      const shots = await this.ctx.checkpoints.checkpoint<AnimeShot[]>(
        shotsFile,
        (d) => Array.isArray(d) && d.length > 0,
        async () => {
          await run(
            path.join(this.ctx.runtime, 'python/python.exe'),
            [path.join(this.ctx.workers, 'anime_worker.py'), 'detect-scenes', '--input', episodeSource, '--output', shotsFile],
            {
              signal,
              progress: (line) => {
                try {
                  const p = JSON.parse(line);
                  if (Number.isFinite(p.progress)) this.ctx.update(job, { progress: 22 + p.progress * 26, message: p.message });
                } catch {}
              },
            }
          );
          return JSON.parse(await fs.readFile(shotsFile, 'utf8'));
        },
        this.ctx.checkpoints.fingerprint({ episode: await hash(episodeSource), v: 1 })
      );
      phase('music', 50, 'Mapping music beat grid and rhythm dynamics');
      const musicMapFile = path.join(work, 'music_map.json');
      const musicMap = await this.ctx.checkpoints.checkpoint<MusicMap>(
        musicMapFile,
        (d) => typeof d === 'object' && Array.isArray(d.beats),
        async () => {
          await run(
            path.join(this.ctx.runtime, 'python/python.exe'),
            [path.join(this.ctx.workers, 'anime_worker.py'), 'analyze-music', '--input', musicSource, '--output', musicMapFile],
            {
              signal,
              progress: (line) => {
                try {
                  const p = JSON.parse(line);
                  if (Number.isFinite(p.progress)) this.ctx.update(job, { progress: 50 + p.progress * 22, message: p.message });
                } catch {}
              },
            }
          );
          return JSON.parse(await fs.readFile(musicMapFile, 'utf8'));
        },
        this.ctx.checkpoints.fingerprint({ music: await hash(musicSource), v: 1 })
      );
      phase('transcribing', 74, `Transcribing dialogue (${lang === 'ja' ? 'Japanese' : 'English'})`);
      const transcriptFile = path.join(work, 'transcript.json');
      const transcript = await this.ctx.checkpoints.checkpoint<Transcript>(
        transcriptFile,
        (d) => d.version === 1 && Array.isArray(d.segments),
        async () => {
          const transcribeArgs = [
            path.join(this.ctx.workers, 'anime_worker.py'),
            'transcribe',
            '--input',
            audio,
            '--output',
            transcriptFile,
            '--models',
            path.join(this.ctx.runtime, 'models'),
            '--language',
            lang,
          ];
          if (this.ctx.hardware.cudaSpeechCandidate) transcribeArgs.push('--gpu');
          await run(path.join(this.ctx.runtime, 'python/python.exe'), transcribeArgs, {
            signal,
            progress: (line) => {
              try {
                const p = JSON.parse(line);
                if (Number.isFinite(p.progress)) this.ctx.update(job, { progress: 74 + p.progress * 12, message: p.message });
              } catch {}
            },
          });
          return JSON.parse(await fs.readFile(transcriptFile, 'utf8'));
        },
        this.ctx.checkpoints.fingerprint({ audio: await hash(audio), language: lang, v: 1 })
      );
      phase('analyzing', 86, 'Analyzing motion, audio dynamics and discovering candidate moments');
      const candidatesFile = path.join(work, 'candidates.json');
      const candidates = await this.ctx.checkpoints.checkpoint<AnimeCandidate[]>(
        candidatesFile,
        (d) => Array.isArray(d) && d.length > 0,
        async () => {
          const candidateArgs = [
            path.join(this.ctx.workers, 'anime_worker.py'),
            'score-candidates',
            '--source',
            episodeSource,
            '--shots',
            shotsFile,
            '--audio',
            audio,
            '--transcript',
            transcriptFile,
            '--models',
            path.join(this.ctx.runtime, 'models'),
            '--output',
            candidatesFile,
          ];
          if (this.ctx.hardware.cudaSpeechCandidate) candidateArgs.push('--gpu');
          await run(path.join(this.ctx.runtime, 'python/python.exe'), candidateArgs, {
            signal,
            progress: (line) => {
              try {
                const p = JSON.parse(line);
                if (Number.isFinite(p.progress)) this.ctx.update(job, { progress: 86 + p.progress * 7, message: p.message });
              } catch {}
            },
          });
          return JSON.parse(await fs.readFile(candidatesFile, 'utf8'));
        },
        this.ctx.checkpoints.fingerprint({ shots: await hash(shotsFile), audio: await hash(audio), transcript: await hash(transcriptFile), v: 1 })
      );
      phase('analyzing', 90, 'Selecting 3–5 diverse edit concepts');
      const conceptsFile = path.join(work, 'edit_concepts.json');
      const concepts = await this.ctx.checkpoints.checkpoint<AnimeEditConcept[]>(
        conceptsFile,
        (d) => Array.isArray(d) && d.length >= 1,
        async () => {
          return selectAnimeMoments(
            candidates,
            musicMap,
            this.ctx.store.settings(),
            (p) => this.ctx.key(p),
            signal,
            (message) => this.ctx.update(job, { message, provider: message.startsWith('Gemini') ? 'Gemini' : job.provider })
          );
        },
        this.ctx.checkpoints.fingerprint({ candidates: await hash(candidatesFile), v: 1 })
      );
      const aspect = job.input.outputAspect || '9:16';
      phase('rendering', 92, `Rendering ${concepts.length} ${aspect} AMVs`);
      for (let i = 0; i < concepts.length; i++) {
        signal.throwIfAborted();
        const concept = concepts[i];
        const id = String(concept.id).padStart(2, '0');
        const file = path.join(output, `reelmind_${id}.mp4`);
        const plan = planAnimeEdit(concept, musicMap, shots, 30, aspect);
        plan.renderQuality = this.ctx.store.settings().quality;
        const planHash = this.ctx.checkpoints.fingerprint({ plan, quality: this.ctx.store.settings().quality });
        const previous = job.outputs.find((r) => r.id === id);
        if (previous?.planHash === planHash && await exists(file)) {
          try {
            await probe(this.ctx.runtime, file, signal);
            continue;
          } catch {}
        }
        const clipWork = path.join(work, 'amv_' + id);
        await fs.mkdir(clipWork, { recursive: true });
        await atomicJSON(path.join(clipWork, 'plan.json'), plan);
        await this.ctx.checkpoints.seal(path.join(clipWork, 'plan.json'));
        this.ctx.update(job, { message: `Rendering AMV ${i + 1} of ${concepts.length} · ${concept.title}` });
        const partial = file + '.partial.mp4';
        await renderAnimeAMV(
          this.ctx.runtime,
          episodeSource,
          musicPath ? musicSource : undefined,
          plan,
          partial,
          clipWork,
          this.ctx.store.settings().quality,
          this.ctx.hardware,
          signal,
          (n) => this.ctx.update(job, { progress: 92 + ((i + n) / concepts.length) * 7 }),
          (message) => this.ctx.update(job, { fallbacks: [...new Set([...(job.fallbacks || []), message])], message }),
          selectedAudioIdx
        );
        await fs.rename(partial, file);
        job.outputs = job.outputs.filter((r) => r.id !== id);
        job.outputs.push({
          id,
          title: concept.title,
          duration: plan.duration,
          file,
          reason: `${concept.category.toUpperCase()} · ${concept.style.replace(/_/g, ' ')} (${concept.qualityScore}% match)`,
          planHash,
        });
        this.ctx.update(job, { outputs: job.outputs });
      }
      const episodeFile = path.join(work, 'episode.json');
      const analysis: AnimeEpisodeAnalysis = {
        version: 1,
        metadata: {
          duration: media.duration,
          width: media.width,
          height: media.height,
          fps: media.fps,
          videoCodec: media.videoCodec,
          audioCodec: media.audioCodec,
        },
        language: lang,
        shotCount: shots.length,
        dialogueCount: transcript.segments.length,
        musicBpm: musicMap.bpm,
        candidatesCount: candidates.length,
        candidates: candidates.slice(0, 30),
        conceptsCount: concepts.length,
        concepts,
      };
      await atomicJSON(episodeFile, analysis);
      await this.ctx.checkpoints.seal(episodeFile);
      this.ctx.update(job, {
        stage: 'completed',
        progress: 100,
        message: `${job.outputs.length} AMV Edits ready to save (${musicMap.bpm} BPM)`,
        cleanupAt: this.ctx.store.now() + DAY,
        animeAnalysis: {
          shotCount: shots.length,
          bpm: musicMap.bpm,
          beatsCount: musicMap.beats.length,
          language: lang,
          candidatesCount: candidates.length,
          candidates: candidates.slice(0, 30),
          conceptsCount: concepts.length,
          concepts,
        },
      });
      this.ctx.notify(job);
    } catch (error) {
      const partials: string[] = [];
      try {
        for (const n of await fs.readdir(output)) {
          if (n.endsWith('.partial.mp4') || n.endsWith('.part') || n.endsWith('.part.wav')) {
            partials.push(path.join(output, n));
          }
        }
      } catch {}
      try {
        for (const n of await fs.readdir(work)) {
          if (n.endsWith('.part') || n.endsWith('.part.wav')) {
            partials.push(path.join(work, n));
          }
        }
      } catch {}
      try {
        for (const e of await fs.readdir(work)) {
          if (e.startsWith('amv_')) {
            const d = path.join(work, e);
            try {
              for (const n of await fs.readdir(d)) {
                if (n.endsWith('.partial.mp4') || n === 'captions.ass' || n === 'render.ffscript') {
                  partials.push(path.join(d, n));
                }
              }
            } catch {}
          }
        }
      } catch {}
      await cleanupTemps(partials);
      this.ctx.update(job, {
        stage: signal.aborted ? 'paused' : 'failed',
        cleanupAt: this.ctx.store.now() + DAY,
        message: signal.aborted ? 'Paused · resume within 24 hours' : 'Anime analysis needs attention',
        error: signal.aborted ? undefined : String(error instanceof Error ? error.message : error).slice(0, 1600),
      });
    }
  }

  async rerender(
    job: Job,
    conceptId: number,
    options: AnimeRerenderOptions,
    signal: AbortSignal
  ): Promise<void> {
    const work = this.ctx.work(job.id);
    const output = this.ctx.out(job.id);
    const episodeSource = path.join(work, 'episode' + path.extname(job.input.value).toLowerCase());
    if (!await exists(episodeSource)) throw new Error('Source episode file is no longer in workspace.');
    const musicPath = job.input.musicPath || '';
    const musicSource = path.join(work, 'music' + path.extname(musicPath).toLowerCase());
    const musicMapFile = path.join(work, 'music_map.json');
    const shotsFile = path.join(work, 'shots.json');
    const conceptsFile = path.join(work, 'edit_concepts.json');
    if (!await exists(conceptsFile) || !await exists(musicMapFile) || !await exists(shotsFile)) {
      throw new Error('Analysis data files missing for this project.');
    }
    const musicMap: MusicMap = JSON.parse(await fs.readFile(musicMapFile, 'utf8'));
    const shots: AnimeShot[] = JSON.parse(await fs.readFile(shotsFile, 'utf8'));
    const concepts: AnimeEditConcept[] = JSON.parse(await fs.readFile(conceptsFile, 'utf8'));
    const concept = concepts.find((c) => c.id === conceptId);
    if (!concept) throw new Error(`AMV Concept #${conceptId} not found.`);

    if (options.style) {
      concept.style = options.style;
      await atomicJSON(conceptsFile, concepts);
      if (job.animeAnalysis?.concepts) {
        const jc = job.animeAnalysis.concepts.find((c) => c.id === conceptId);
        if (jc) jc.style = options.style;
      }
    }
    const aspect = options.aspectRatio || job.input.outputAspect || '9:16';
    const plan = planAnimeEdit(concept, musicMap, shots, 30, aspect);
    plan.renderQuality = this.ctx.store.settings().quality;
    if (options.sourceAudioMix !== undefined) {
      plan.audio.sourceAudioMix = Math.max(0, Math.min(1, options.sourceAudioMix));
    }
    if (options.musicMix !== undefined) {
      plan.audio.musicMix = Math.max(0, Math.min(1, options.musicMix));
    }

    const media = await probe(this.ctx.runtime, episodeSource, signal);
    const lang = job.input.language || 'ja';
    let selectedAudioIdx = 0;
    if (media.audioStreams && media.audioStreams.length > 1) {
      const match = media.audioStreams.find((s: { index: number; streamIndex: number; language: string; title: string }) =>
        lang === 'ja'
          ? s.language.includes('ja') || s.language.includes('jpn') || s.title.toLowerCase().includes('jap')
          : s.language.includes('en') || s.language.includes('eng') || s.title.toLowerCase().includes('eng')
      );
      if (match) selectedAudioIdx = match.index;
    }

    const clipId = String(concept.id).padStart(2, '0');
    const file = path.join(output, `reelmind_${clipId}.mp4`);
    const planHash = this.ctx.checkpoints.fingerprint({ plan, quality: this.ctx.store.settings().quality, opts: options });
    const clipWork = path.join(work, 'amv_' + clipId);
    await fs.mkdir(clipWork, { recursive: true });
    await atomicJSON(path.join(clipWork, 'plan.json'), plan);
    await this.ctx.checkpoints.seal(path.join(clipWork, 'plan.json'));

    this.ctx.update(job, { message: `Re-rendering AMV ${concept.id} · ${concept.title} (${concept.style.replace(/_/g, ' ')})` });
    const partial = file + '.partial.mp4';
    await renderAnimeAMV(
      this.ctx.runtime,
      episodeSource,
      musicPath ? musicSource : undefined,
      plan,
      partial,
      clipWork,
      this.ctx.store.settings().quality,
      this.ctx.hardware,
      signal,
      (progress) => this.ctx.update(job, { message: `Re-rendering AMV ${concept.id} · ${Math.floor(progress * 100)}%` }),
      (message) => this.ctx.update(job, { fallbacks: [...new Set([...(job.fallbacks || []), message])], message }),
      selectedAudioIdx
    );
    await fs.rename(partial, file);
    job.outputs = job.outputs.filter((r) => r.id !== clipId);
    job.outputs.push({
      id: clipId,
      title: concept.title,
      duration: plan.duration,
      file,
      reason: `${concept.category.toUpperCase()} · ${concept.style.replace(/_/g, ' ')} (${concept.qualityScore}% match)`,
      planHash,
    });
    job.outputs.sort((a, b) => a.id.localeCompare(b.id));
    this.ctx.update(job, {
      message: `AMV ${concept.id} re-rendered with ${concept.style.replace(/_/g, ' ')}`,
      outputs: job.outputs,
      animeAnalysis: job.animeAnalysis,
    });
    this.ctx.notify(job);
  }
}
