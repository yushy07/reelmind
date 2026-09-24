import type { Job } from '../shared/types';
import type { Store } from './storage';

export type JobProcessor = (job: Job, isAnime: boolean) => Promise<void>;

export interface QueueOptions {
  concurrency?: number;
}

/**
 * JobQueue provides a concurrency-controlled FIFO work queue for background rendering.
 *
 * Why FIFO:
 * Older jobs (by createdAt) are processed first to guarantee fairness and avoid starvation.
 * Previous reverse().find() had ambiguous order depending on DB rowid; explicit createdAt
 * sorting ensures predictable, deterministic job scheduling.
 *
 * Concurrency:
 * Defaults to 1 to strictly bound GPU VRAM usage and complex FFmpeg filter memory on local hardware.
 */
export class JobQueue {
  stopping = false;
  active = new Map<string, AbortController>();
  concurrency: number;

  constructor(
    private store: Store,
    private processor: JobProcessor,
    opts: QueueOptions = {}
  ) {
    this.concurrency = Math.max(1, opts.concurrency ?? 1);
  }

  pendingJobs(): Job[] {
    return this.store
      .jobs()
      .filter((j) => j.stage === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  pump(): void {
    if (this.stopping) return;
    const availableSlots = this.concurrency - this.active.size;
    if (availableSlots <= 0) return;

    const queued = this.pendingJobs().slice(0, availableSlots);
    for (const job of queued) {
      if (this.active.has(job.id)) continue;
      const isAnime = job.studio === 'anime';
      void this.processor(job, isAnime);
    }
  }

  register(id: string, controller: AbortController): void {
    this.active.set(id, controller);
  }

  release(id: string): void {
    this.active.delete(id);
    this.pump();
  }

  cancel(id: string): boolean {
    const ctrl = this.active.get(id);
    if (ctrl) {
      ctrl.abort();
      this.active.delete(id);
      this.pump();
      return true;
    }
    return false;
  }

  has(id: string): boolean {
    return this.active.has(id);
  }

  get size(): number {
    return this.active.size;
  }

  entries(): IterableIterator<[string, AbortController]> {
    return this.active.entries();
  }
}
