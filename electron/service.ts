import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, removeWorkspace, externalDirectory, hash } from './storage';
import { DAY, validateUrl } from './core';
import { ModelManager, TURBO } from './models';
import { run } from './process';
import { probe } from './media';
import { defaultHardware, configureHardware, type HardwareInfo } from './hardware';
import { CheckpointStore, seal, checkpoint } from './checkpoint';
import { JobQueue } from './queue';
import { PodcastPipeline } from './pipelines/podcast';
import { AnimePipeline } from './pipelines/anime';
import type { PipelineContext } from './pipelines/base';
import type {
  Job,
  Provider,
  CreateInput,
  AnimeCreateInput,
  AnimeRerenderOptions,
} from '../shared/types';

const exists = async (file: string) => !!await fs.stat(file).catch(() => null);

export class Service {
  saving = new Set<string>();
  allowedInputs = new Set<string>();
  renderHardware: HardwareInfo = defaultHardware();
  models: ModelManager;
  checkpoints: CheckpointStore;
  queue: JobQueue;
  podcastPipeline: PodcastPipeline;
  animePipeline: AnimePipeline;

  get active() {
    return this.queue.active;
  }
  get stopping() {
    return this.queue.stopping;
  }
  set stopping(v: boolean) {
    this.queue.stopping = v;
  }

  constructor(
    public root: string,
    public runtime: string,
    public workers: string,
    public store: Store,
    public changed: () => void,
    public notify: (j: Job) => void
  ) {
    this.models = new ModelManager(root, changed);
    this.checkpoints = new CheckpointStore(store);

    const ctx: PipelineContext = {
      root,
      runtime,
      workers,
      store,
      hardware: this.renderHardware,
      checkpoints: this.checkpoints,
      models: this.models,
      work: (id: string) => this.work(id),
      out: (id: string) => this.out(id),
      update: (job: Job, patch: Partial<Job>) => this.update(job, patch),
      notify: (job: Job) => this.notify(job),
      key: (p: Provider) => this.key(p),
    };

    this.podcastPipeline = new PodcastPipeline(ctx);
    this.animePipeline = new AnimePipeline(ctx);

    this.queue = new JobQueue(store, async (job, isAnime) => {
      const controller = new AbortController();
      this.queue.register(job.id, controller);
      try {
        if (isAnime) await this.animePipeline.process(job, controller.signal);
        else await this.podcastPipeline.process(job, controller.signal);
      } finally {
        this.queue.release(job.id);
      }
    });
  }

  configureHardware(vramMb: number): void {
    configureHardware(this.renderHardware, vramMb);
  }

  work(id: string): string {
    if (!/^[\da-f-]{36}$/.test(id)) throw new Error('Invalid project');
    return path.join(this.root, 'work', id);
  }

  out(id: string): string {
    this.work(id);
    return path.join(this.root, 'outputs', id);
  }

  update(job: Job, patch: Partial<Job>): void {
    Object.assign(job, patch, { updatedAt: this.store.now() });
    this.store.put(job);
    this.changed();
  }

  private keyCache = new Map<Provider, string>();

  async key(p: Provider): Promise<string> {
    if (this.keyCache.has(p)) {
      return this.keyCache.get(p)!;
    }
    const val = await run(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.workers, 'credentials.ps1')],
      { input: JSON.stringify({ action: 'get', provider: p }) }
    );
    this.keyCache.set(p, val);
    return val;
  }

  async setKey(p: Provider, key: string): Promise<void> {
    this.keyCache.set(p, key);
    await run(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.workers, 'credentials.ps1')],
      { input: JSON.stringify({ action: 'set', provider: p, key }) }
    );
  }

  async readiness(): Promise<{ ready: boolean; missing: string[] }> {
    const required = [
      'ffmpeg.exe',
      'ffprobe.exe',
      'yt-dlp.exe',
      'python/python.exe',
      'models/whisper-small/model.bin',
      'models/whisper-small/config.json',
      'models/whisper-small/vocabulary.txt',
      'models/whisper-small/tokenizer.json',
      'models/face.onnx',
      'models/speaker.onnx',
      'fonts/NotoSans-Bold.ttf',
      'fonts/NotoSansDevanagari-Bold.ttf',
      'fonts/NotoSansCJKjp-Bold.otf',
    ];
    const missing: string[] = [];
    for (const f of required) if (!await exists(path.join(this.runtime, f))) missing.push(f);
    return { ready: !missing.length, missing };
  }

  async init(): Promise<void> {
    await fs.mkdir(path.join(this.root, 'work'), { recursive: true });
    await fs.mkdir(path.join(this.root, 'outputs'), { recursive: true });
    const now = this.store.now();
    for (const j of this.store.jobs()) {
      if (['importing', 'scenes', 'music', 'transcribing', 'analyzing', 'framing', 'rendering'].includes(j.stage)) {
        this.update(j, {
          stage: 'paused',
          message: 'Processing was interrupted. Resume within 24 hours.',
          cleanupAt: Math.max(j.updatedAt, now) + DAY,
        });
      }
    }
    await this.cleanup();
    this.pump();
  }

  async create(request: CreateInput): Promise<string> {
    const { pastedTranscript, ...input } = request;
    if (!(await this.readiness()).ready) throw new Error('Download the local engine in Settings first.');
    if (pastedTranscript !== undefined) {
      if (!pastedTranscript.trim()) throw new Error('Paste transcript text or leave it blank to transcribe the video.');
      if (pastedTranscript.length > 200_000) throw new Error('Transcript is too long. Keep it under 200,000 characters.');
    }
    if (input.kind === 'url') input.value = validateUrl(input.value);
    else if (!this.allowedInputs.has(input.value)) throw new Error('Choose your local video with the file picker.');

    const now = this.store.now();
    const title = input.kind === 'local' ? path.basename(input.value) : 'Linked video';
    const job: Job = {
      id: randomUUID(),
      name: input.name?.trim() || undefined,
      title,
      input,
      stage: 'queued',
      checkpoint: 'queued',
      progress: 0,
      message: 'Ready to process',
      createdAt: now,
      updatedAt: now,
      outputs: [],
      provider: 'Local',
      fallbacks: [],
    };
    job.transcriptSource = pastedTranscript === undefined ? 'whisper' : 'pasted';
    job.transcriptionMode = this.store.settings().transcriptionMode || 'standard';
    if (job.transcriptSource === 'whisper' && job.transcriptionMode === 'turbo' && !this.models.state.ready) {
      throw new Error('Download Turbo in Settings first, or choose Standard.');
    }
    job.modelRevision = job.transcriptionMode === 'turbo' ? TURBO.revision : 'whisper-small-bundled';
    if (pastedTranscript !== undefined) {
      const work = this.work(job.id);
      await fs.mkdir(work, { recursive: true });
      const inputFile = path.join(work, 'pasted-transcript.txt');
      await fs.writeFile(inputFile + '.part', pastedTranscript, 'utf8');
      await fs.rename(inputFile + '.part', inputFile);
    }
    this.store.put(job);
    this.changed();
    this.pump();
    return job.id;
  }

  async createAnime(request: AnimeCreateInput): Promise<string> {
    if (!(await this.readiness()).ready) throw new Error('Download the local engine in Settings first.');
    if (!this.allowedInputs.has(request.episodePath)) throw new Error('Choose your anime episode with the file picker.');
    if (!this.allowedInputs.has(request.musicPath)) throw new Error('Choose your music track with the file picker.');
    const now = this.store.now();
    const title = request.name?.trim() || path.basename(request.episodePath);
    const job: Job = {
      id: randomUUID(),
      studio: 'anime',
      name: request.name?.trim() || undefined,
      title,
      input: {
        kind: 'local',
        value: request.episodePath,
        musicPath: request.musicPath,
        language: request.language || 'ja',
        name: request.name?.trim() || undefined,
        outputAspect: request.outputAspect || '9:16',
      },
      stage: 'queued',
      checkpoint: 'queued',
      progress: 0,
      message: 'Ready to analyze anime episode',
      createdAt: now,
      updatedAt: now,
      outputs: [],
      provider: 'Local',
      fallbacks: [],
    };
    this.store.put(job);
    this.changed();
    this.pump();
    return job.id;
  }

  pump(): void {
    this.queue.pump();
  }

  async action(id: string, action: 'pause' | 'resume' | 'delete'): Promise<void> {
    const job = this.store.get(id);
    if (!job) throw new Error('Project not found.');
    if (this.saving.has(id)) throw new Error('Wait for the save to finish.');
    if (action === 'pause') {
      if (this.active.has(id)) this.active.get(id)!.abort();
      else if (job.stage === 'queued') this.update(job, { stage: 'paused', cleanupAt: this.store.now() + DAY, message: 'Paused · recover within 24 hours' });
      return;
    }
    if (action === 'delete') {
      if (this.active.has(id)) {
        const controller = this.active.get(id)!;
        controller.abort();
        let waits = 0;
        while (this.active.has(id) && waits++ < 30) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      await removeWorkspace(path.join(this.root, 'work'), this.work(id));
      await removeWorkspace(path.join(this.root, 'outputs'), this.out(id));
      this.store.remove(id);
      this.changed();
      return;
    }
    if (this.active.has(id)) throw new Error('Wait for processing to stop.');
    if (job.workingDeleted || job.stage === 'expired') throw new Error('Recovery expired. Import your video again.');
    if (!['paused', 'failed'].includes(job.stage)) throw new Error('This project cannot be resumed.');
    if (job.cleanupAt && job.cleanupAt <= this.store.now()) {
      await this.cleanup();
      throw new Error('Recovery expired. Import your video again.');
    }
    this.update(job, { stage: 'queued', cleanupAt: undefined, error: undefined, message: 'Resuming from saved progress' });
    this.pump();
  }

  async rerenderAnime(id: string, conceptId: number, options: AnimeRerenderOptions = {}): Promise<void> {
    const job = this.store.get(id);
    if (!job || job.studio !== 'anime') throw new Error('Anime project not found.');
    if (this.queue.has(id)) throw new Error('Project is currently busy processing.');
    const controller = new AbortController();
    this.queue.register(job.id, controller);
    try {
      await this.animePipeline.rerender(job, conceptId, options, controller.signal);
    } finally {
      this.queue.release(job.id);
    }
  }

  async save(id: string, dir: string, blocked: string[], reelId?: string): Promise<string> {
    const job = this.store.get(id);
    if (!job || !['completed', 'expired'].includes(job.stage)) throw new Error('Finish rendering before saving.');
    if (this.saving.has(id)) throw new Error('Already saving.');
    this.saving.add(id);
    try {
      const dest = await externalDirectory(dir, blocked);
      const targets = reelId ? job.outputs.filter((r) => r.id === reelId) : job.outputs;
      if (!targets.length) throw new Error('Reel not found.');
      for (const reel of targets) {
        if (reel.savedPath) continue;
        let target = path.join(dest, path.basename(reel.file));
        let suffix = 1;
        while (await exists(target)) target = path.join(dest, `reelmind_${reel.id}_${suffix++}.mp4`);
        const partial = target + '.' + randomUUID() + '.partial';
        try {
          await fs.copyFile(reel.file, partial, 1);
          const expected = await hash(reel.file);
          if (expected !== (await hash(partial))) throw new Error('Saved copy did not match. Your internal Reel is safe.');
          await probe(this.runtime, partial);
          await fs.copyFile(partial, target, 1);
          if (expected !== (await hash(target))) throw new Error('Saved file verification failed. Your internal Reel is safe.');
          await fs.unlink(partial);
        } catch (error) {
          await fs.unlink(partial).catch(() => {});
          throw error;
        }
        reel.savedPath = target;
        this.update(job, { outputs: job.outputs });
        await fs.unlink(reel.file).catch(() => {});
      }
      const allSaved = job.outputs.every((r) => !!r.savedPath);
      this.update(job, { message: allSaved ? 'All Reels saved outside REELMIND' : 'Selected Reel saved' });
      return dest;
    } finally {
      this.saving.delete(id);
    }
  }

  async cleanup(): Promise<void> {
    const now = this.store.now();
    for (const job of this.store.jobs()) {
      if (this.queue.has(job.id) || this.saving.has(job.id) || job.workingDeleted || !job.cleanupAt || job.cleanupAt > now) {
        continue;
      }
      // Scrub transient temps before removing workspace
      try {
        const outDir = this.out(job.id);
        if (await exists(outDir)) {
          for (const n of await fs.readdir(outDir)) {
            if (n.endsWith('.partial.mp4') || n.endsWith('.part') || n.endsWith('.part.wav')) {
              await fs.unlink(path.join(outDir, n));
            }
          }
        }
      } catch {}
      try {
        const w = this.work(job.id);
        for (const e of await fs.readdir(w)) {
          if (e.startsWith('clip_') || e.startsWith('amv_')) {
            const d = path.join(w, e);
            for (const n of await fs.readdir(d)) {
              if (n.endsWith('.partial.mp4') || n === 'captions.ass' || n === 'render.ffscript') {
                await fs.unlink(path.join(d, n));
              }
            }
          }
        }
      } catch {}
      await removeWorkspace(path.join(this.root, 'work'), this.work(job.id));
      job.input.value = '';
      this.update(job, {
        workingDeleted: true,
        stage: job.stage === 'completed' ? 'completed' : 'expired',
        message: job.stage === 'completed' ? 'Working files cleaned up · finished Reels remain' : 'Recovery expired · import the source again',
        error: undefined,
      });
    }

    // Orphan reaper pass: scan work and outputs directories for stale temporary files older than DAY
    try {
      const activeIds = new Set(this.store.jobs().map((j) => j.id));
      for (const baseDir of [path.join(this.root, 'work'), path.join(this.root, 'outputs')]) {
        if (!await exists(baseDir)) continue;
        for (const entry of await fs.readdir(baseDir, { withFileTypes: true })) {
          const entryPath = path.join(baseDir, entry.name);
          const stat = await fs.stat(entryPath).catch(() => null);
          if (!stat) continue;
          const isStale = now - stat.mtimeMs > DAY;
          if (entry.isDirectory()) {
            if (!activeIds.has(entry.name) && isStale) {
              await removeWorkspace(baseDir, entryPath).catch(() => {});
            }
          } else if (
            entry.name.endsWith('.partial.mp4') ||
            entry.name.endsWith('.part') ||
            entry.name.endsWith('.part.wav') ||
            entry.name.endsWith('.tmp')
          ) {
            if (isStale) await fs.unlink(entryPath).catch(() => {});
          }
        }
      }
    } catch {}
  }

  async shutdown(): Promise<void> {
    this.queue.stopping = true;
    for (const [id, controller] of this.queue.active) {
      const job = this.store.get(id);
      if (job) this.update(job, { stage: 'paused', cleanupAt: this.store.now() + DAY, message: 'Paused when the app closed' });
      controller.abort();
    }
    while (this.queue.size) await new Promise((r) => setTimeout(r, 50));
  }

  // Compatibility shims for legacy callers/tests
  async seal(file: string): Promise<void> {
    return seal(file);
  }
  async checkpoint<T>(file: string, validate: (data: any) => boolean, generate: () => Promise<T>, dependency?: string): Promise<T> {
    return checkpoint(this.store, file, validate, generate, dependency);
  }
  async process(job: Job): Promise<void> {
    const controller = new AbortController();
    this.queue.register(job.id, controller);
    try {
      await this.podcastPipeline.process(job, controller.signal);
    } finally {
      this.queue.release(job.id);
    }
  }
  async processAnime(job: Job): Promise<void> {
    const controller = new AbortController();
    this.queue.register(job.id, controller);
    try {
      await this.animePipeline.process(job, controller.signal);
    } finally {
      this.queue.release(job.id);
    }
  }
}
