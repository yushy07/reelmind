import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, hash, exists, cleanupWorkingTemps } from '../storage';
import { DAY, planEdit, validateClipCandidate } from '../core';
import { analyze } from '../providers';
import { candidateTexts, semanticSelection, SEMANTIC_VERSION } from '../semantic';
import { transcribeWithFallback } from '../transcription';
import { run } from '../process';
import { probe, render } from '../media';
import { parsePastedTranscript } from '../pasted-transcript';
import type { Job, Stage, Transcript, Candidate, Frame } from '../../shared/types';
import type { PipelineContext } from './base';

export class PodcastPipeline {
  constructor(private ctx: PipelineContext) {}

  async process(job: Job, signal: AbortSignal): Promise<void> {
    const work = this.ctx.work(job.id);
    const output = this.ctx.out(job.id);
    const phase = (stage: Stage, progress: number, message: string) =>
      this.ctx.update(job, { stage, checkpoint: stage, progress, message, cleanupAt: undefined });

    try {
      await fs.mkdir(work, { recursive: true });
      await fs.mkdir(output, { recursive: true });
      phase('importing', 2, 'Preparing your video');
      let source = path.join(work, 'source.mkv');
      if (job.input.kind === 'local') {
        source = path.join(work, 'source' + path.extname(job.input.value).toLowerCase());
        if (!await exists(source)) {
          const stat = await fs.stat(job.input.value);
          const disk = await fs.statfs(work);
          if (Number(disk.bavail) * Number(disk.bsize) < stat.size * 2 + 2e9) {
            throw new Error('Not enough free disk space for source, working files and Reels.');
          }
          await fs.copyFile(job.input.value, source + '.part');
          signal.throwIfAborted();
          await fs.rename(source + '.part', source);
        }
      } else if (!await exists(source)) {
        const downloaderArgs = [
          '--ignore-config',
          '--no-playlist',
          '--no-warnings',
          '--socket-timeout',
          '30',
          '--retries',
          '3',
          '--fragment-retries',
          '3',
          '--js-runtimes',
          `node:${process.execPath}`,
          '--cache-dir',
          path.join(work, 'download-cache'),
        ];
        const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
        let raw: string;
        try {
          raw = await run(
            path.join(this.ctx.runtime, 'yt-dlp.exe'),
            [...downloaderArgs, '--skip-download', '--dump-single-json', '--', job.input.value],
            { signal: probeSignal, env: { ELECTRON_RUN_AS_NODE: '1' } }
          );
        } catch (err: any) {
          if (probeSignal.aborted && !signal.aborted) {
            throw new Error('Video link verification timed out after 45s. Check network access or ensure the URL is publicly available.');
          }
          throw err;
        }
        const meta = JSON.parse(raw);
        if (
          meta.is_live ||
          meta.live_status === 'is_live' ||
          meta.has_drm ||
          (meta.availability && !['public', 'unlisted'].includes(meta.availability))
        ) {
          throw new Error('Only public, non-live videos without DRM are supported.');
        }
        if (meta.title) this.ctx.update(job, { title: String(meta.title).slice(0, 180) });
        const disk = await fs.statfs(work);
        if (Number(disk.bavail) * Number(disk.bsize) < Math.max(2e9, Number(meta.filesize || meta.filesize_approx || 0) * 2)) {
          throw new Error('Not enough free disk space to download and process this video.');
        }
        await run(
          path.join(this.ctx.runtime, 'yt-dlp.exe'),
          [
            ...downloaderArgs,
            '--newline',
            '--max-filesize',
            '20G',
            '--ffmpeg-location',
            this.ctx.runtime,
            '-f',
            'bv*[height<=1080]+ba/b[height<=1080]/b',
            '--merge-output-format',
            'mkv',
            '--remux-video',
            'mkv',
            '-o',
            path.join(work, 'source.%(ext)s'),
            '--',
            job.input.value,
          ],
          {
            signal,
            env: { ELECTRON_RUN_AS_NODE: '1' },
            progress: (line) => {
              const match = line.match(/\[download\]\s+([\d.]+)%/);
              if (match) {
                const pct = parseFloat(match[1]);
                if (Number.isFinite(pct)) {
                  this.ctx.update(job, {
                    progress: 2 + (pct / 100) * 8,
                    message: `Downloading linked video · ${pct.toFixed(0)}%`,
                  });
                }
              }
            },
          }
        );
      }
      const media = await probe(this.ctx.runtime, source, signal);
      this.ctx.update(job, { duration: media.duration });
      const audio = path.join(work, 'audio.wav');
      if (!await exists(audio)) {
        await run(
          path.join(this.ctx.runtime, 'ffmpeg.exe'),
          ['-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio + '.part.wav'],
          { signal }
        );
        await fs.rename(audio + '.part.wav', audio);
      }
      phase(
        'transcribing',
        12,
        job.transcriptSource === 'pasted'
          ? 'Aligning your pasted transcript'
          : 'Listening locally · English, Hindi and Japanese'
      );
      const transcriptFile = path.join(work, 'transcript.json');
      let transcript = await this.ctx.checkpoints.checkpoint<Transcript>(
        transcriptFile,
        (d) => d.version === 1 && Array.isArray(d.segments) && d.segments.length,
        async () => {
          await this.ctx.checkpoints.invalidate(
            path.join(work, 'frames.json'),
            path.join(work, 'candidates.json')
          );
          if (job.transcriptSource === 'pasted') {
            const pasted = await fs.readFile(path.join(work, 'pasted-transcript.txt'), 'utf8');
            const value = parsePastedTranscript(pasted, media.duration);
            this.ctx.update(job, {
              transcriptTiming: value.timingSource,
              message:
                value.timingSource === 'estimated'
                  ? 'Pasted transcript · estimated timing; captions may drift'
                  : 'Pasted transcript · subtitle timing preserved',
            });
            return value;
          }
          const transcribe = async (mode: 'standard' | 'turbo', cpuOnly = false) => {
            const args = [
              path.join(this.ctx.workers, 'worker.py'),
              'transcribe',
              '--input',
              audio,
              '--output',
              transcriptFile,
              '--models',
              path.join(this.ctx.runtime, 'models'),
            ];
            if (mode === 'turbo') args.push('--model-path', this.ctx.models.directory(job.modelRevision));
            if (!cpuOnly && (this.ctx.hardware.cudaSpeechCandidate || this.ctx.hardware.whisperCuda)) args.push('--gpu');
            await run(path.join(this.ctx.runtime, 'python/python.exe'), args, {
              signal,
              progress: (line) => {
                try {
                  const p = JSON.parse(line);
                  if (p.fallback) {
                    this.ctx.update(job, {
                      fallbacks: [...new Set([...(job.fallbacks || []), p.fallback])],
                      message: p.message,
                    });
                  } else if (Number.isFinite(p.progress)) {
                    this.ctx.update(job, {
                      progress: 12 + p.progress * 30,
                      message: `${mode === 'turbo' ? 'Turbo' : 'Standard'} · ${p.message}`,
                    });
                  }
                } catch {}
              },
            });
            const value = JSON.parse(await fs.readFile(transcriptFile, 'utf8'));
            if (value.version !== 1 || !value.segments?.length) throw new Error('Transcription returned no usable speech');
            this.ctx.update(job, { effectiveTranscriptionMode: mode });
            return value as Transcript;
          };
          return transcribeWithFallback(
            job.transcriptionMode || 'standard',
            job.effectiveTranscriptionMode,
            signal,
            transcribe,
            () =>
              this.ctx.update(job, {
                effectiveTranscriptionMode: 'standard',
                message: 'Turbo unavailable · retrying with Whisper small',
                fallbacks: [...new Set([...(job.fallbacks || []), 'Turbo transcription failed; using Whisper small on CPU'])],
              })
          );
        },
        this.ctx.checkpoints.fingerprint({
          audio: await hash(audio),
          mode: job.transcriptionMode || 'standard',
          revision: job.modelRevision || 'whisper-small-bundled',
          transcriptSource: job.transcriptSource || 'whisper',
          pastedHash: job.transcriptSource === 'pasted' ? await hash(path.join(work, 'pasted-transcript.txt')) : undefined,
          version: 2,
        })
      );
      this.ctx.update(job, { transcriptTiming: transcript.timingSource || (job.transcriptSource === 'pasted' ? 'provided' : 'whisper') });
      phase('framing', 43, 'Matching voices and finding faces');
      const speakersFile = path.join(work, 'speakers.json');
      const frames = await this.ctx.checkpoints.checkpoint<Frame[]>(
        path.join(work, 'frames.json'),
        (d) => Array.isArray(d),
        async () => {
          const frameArgs = [
            path.join(this.ctx.workers, 'worker.py'),
            'frame',
            '--input',
            source,
            '--audio',
            audio,
            '--transcript',
            transcriptFile,
            '--speakers-output',
            speakersFile,
            '--output',
            path.join(work, 'frames.json'),
            '--models',
            path.join(this.ctx.runtime, 'models'),
          ];
          if (this.ctx.hardware.onnxGpu || this.ctx.hardware.cudaSpeechCandidate) {
            frameArgs.push('--gpu');
          }
          await run(
            path.join(this.ctx.runtime, 'python/python.exe'),
            frameArgs,
            {
              signal,
              progress: (line) => {
                try {
                  const p = JSON.parse(line);
                  this.ctx.update(job, { progress: 43 + p.progress * 10, message: p.message });
                } catch {}
              },
            }
          );
          return JSON.parse(await fs.readFile(path.join(work, 'frames.json'), 'utf8'));
        },
        this.ctx.checkpoints.fingerprint(transcript.segments.map(({ speaker, ...segment }) => segment))
      );
      if (await exists(speakersFile)) {
        try {
          const speakers: string[] = JSON.parse(await fs.readFile(speakersFile, 'utf8'));
          transcript.segments.forEach((seg, i) => {
            if (speakers[i]) seg.speaker = speakers[i];
          });
        } catch {}
      }
      phase('analyzing', 54, 'Finding moments across the entire video');
      const candidates = await this.ctx.checkpoints.checkpoint<Candidate[]>(
        path.join(work, 'candidates.json'),
        (d) => Array.isArray(d) && d.every((c) => c.end - c.start >= 25 && c.end - c.start <= 75),
        () =>
          analyze(
            transcript,
            this.ctx.store.settings(),
            (p) => this.ctx.key(p),
            signal,
            (message) =>
              this.ctx.update(job, {
                message,
                provider: message.startsWith('Gemini')
                  ? 'Gemini'
                  : message.startsWith('OpenRouter')
                  ? 'OpenRouter'
                  : message.startsWith('Local')
                  ? 'Local'
                  : job.provider,
                fallbacks: message.startsWith('Fallback · ')
                  ? [...new Set([...(job.fallbacks || []), message.slice('Fallback · '.length)])]
                  : job.fallbacks,
              }),
            fetch,
            async (pool) => {
              if (pool.length < 2) return pool;
              this.ctx.update(job, { message: 'Comparing ideas locally · MiniLM' });
              const input = path.join(work, 'embedding-input.json');
              const outputEmbedding = path.join(work, 'embeddings.json');
              await atomicJSON(input, candidateTexts(pool, transcript));
              const semanticArgs = [
                path.join(this.ctx.workers, 'semantic.py'),
                '--input',
                input,
                '--output',
                outputEmbedding,
                '--models',
                path.join(this.ctx.runtime, 'models', 'minilm'),
              ];
              if (this.ctx.hardware.onnxGpu || this.ctx.hardware.cudaSpeechCandidate) {
                semanticArgs.push('--gpu');
              }
              await run(
                path.join(this.ctx.runtime, 'python/python.exe'),
                semanticArgs,
                { signal }
              );
              const vectors = JSON.parse(await fs.readFile(outputEmbedding, 'utf8'));
              const selected = semanticSelection(pool, vectors);
              await atomicJSON(path.join(work, 'embedding-manifest.json'), {
                version: SEMANTIC_VERSION,
                transcript: await hash(transcriptFile),
                input: await hash(input),
                ranges: pool.map((c) => [c.start, c.end]),
              });
              return selected;
            }
          ),
        this.ctx.checkpoints.fingerprint({ transcript, version: SEMANTIC_VERSION })
      );
      if (!candidates.length) {
        this.ctx.update(job, {
          stage: 'completed',
          progress: 100,
          message: 'No strong 25–60 second moments found. Try a different video.',
          cleanupAt: this.ctx.store.now() + DAY,
        });
        this.ctx.notify(job);
        return;
      }
      phase('rendering', 62, `Creating ${candidates.length} Reels`);
      for (let batch = 0; batch < candidates.length; batch += 3) {
        for (let i = batch; i < Math.min(batch + 3, candidates.length); i++) {
          signal.throwIfAborted();
          const id = String(i + 1).padStart(2, '0');
          const file = path.join(output, `reelmind_${id}.mp4`);
          const plan = planEdit(candidates[i], transcript, frames, media.fps);
          const validation = validateClipCandidate(plan, candidates[i]);
          if (!validation.valid) {
            this.ctx.update(job, {
              fallbacks: [...new Set([...(job.fallbacks || []), `Skipped candidate ${i + 1} (${validation.reason})`])]
            });
            continue;
          }
          const planHash = this.ctx.checkpoints.fingerprint({ plan, quality: this.ctx.store.settings().quality });
          const previous = job.outputs.find((r) => r.id === id);
          if (previous?.planHash === planHash && await exists(file)) {
            try {
              await probe(this.ctx.runtime, file, signal);
              continue;
            } catch {}
          }
          const clipWork = path.join(work, 'clip_' + id);
          await fs.mkdir(clipWork, { recursive: true });
          await atomicJSON(path.join(clipWork, 'plan.json'), plan);
          await this.ctx.checkpoints.seal(path.join(clipWork, 'plan.json'));
          this.ctx.update(job, { message: `Batch ${Math.floor(batch / 3) + 1} · rendering Reel ${i + 1} of ${candidates.length}` });
          const partial = file + '.partial.mp4';
          await render(
            this.ctx.runtime,
            source,
            plan,
            partial,
            clipWork,
            this.ctx.store.settings().quality,
            this.ctx.hardware,
            signal,
            (n) => this.ctx.update(job, { progress: 62 + ((i + n) / candidates.length) * 37 }),
            (message) => this.ctx.update(job, { fallbacks: [...new Set([...(job.fallbacks || []), message])], message })
          );
          await fs.rename(partial, file);
          job.outputs = job.outputs.filter((r) => r.id !== id);
          job.outputs.push({
            id,
            title: candidates[i].hook.slice(0, 100),
            duration: plan.duration,
            file,
            reason: candidates[i].reason,
            planHash,
          });
          this.ctx.update(job, { outputs: job.outputs });
        }
      }
      const thumbFile = path.join(output, 'thumbnail.jpg');
      if (!await exists(thumbFile)) {
        await run(
          path.join(this.ctx.runtime, 'ffmpeg.exe'),
          ['-hide_banner', '-y', '-ss', '00:00:05', '-i', source, '-vframes', '1', '-q:v', '3', thumbFile],
          { signal }
        ).catch(() => {});
      }
      this.ctx.update(job, {
        stage: 'completed',
        progress: 100,
        message: `${job.outputs.length} Reels ready to save`,
        cleanupAt: this.ctx.store.now() + DAY,
      });
      this.ctx.notify(job);
    } catch (error) {
      await cleanupWorkingTemps(work, output);
      this.ctx.update(job, {
        stage: signal.aborted ? 'paused' : 'failed',
        cleanupAt: this.ctx.store.now() + DAY,
        message: signal.aborted ? 'Paused · resume within 24 hours' : 'Processing needs attention',
        error: signal.aborted ? undefined : String(error instanceof Error ? error.message : error).slice(0, 1600),
      });
    }
  }
}
