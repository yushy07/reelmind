import test from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../electron/queue';
import type { Job } from '../shared/types';

function createMockStore(jobs: Job[]) {
  return {
    jobs: () => [...jobs],
    get: (id: string) => jobs.find((j) => j.id === id),
  } as any;
}

function makeJob(id: string, createdAt: number, stage: Job['stage'] = 'queued'): Job {
  return {
    id,
    title: `Job ${id}`,
    input: { kind: 'local', value: `test_${id}.mp4` },
    stage,
    checkpoint: 'queued',
    progress: 0,
    message: '',
    createdAt,
    updatedAt: createdAt,
    outputs: [],
    provider: 'Local',
    fallbacks: [],
  };
}

test('JobQueue executes jobs in strict FIFO order based on createdAt', async () => {
  const executed: string[] = [];
  const jobs = [
    makeJob('job-3', 300),
    makeJob('job-1', 100),
    makeJob('job-2', 200),
  ];
  const store = createMockStore(jobs);

  let currentController: AbortController | null = null;
  const queue = new JobQueue(store, async (job) => {
    executed.push(job.id);
    currentController = new AbortController();
    queue.register(job.id, currentController);
  }, { concurrency: 1 });

  // First pump should pick job-1 (createdAt: 100)
  queue.pump();
  assert.deepEqual(executed, ['job-1']);
  assert.equal(queue.has('job-1'), true);

  // While job-1 is active, another pump should not start job-2
  queue.pump();
  assert.deepEqual(executed, ['job-1']);

  // Completing job-1 marks it done and releases
  jobs.find((j) => j.id === 'job-1')!.stage = 'completed';
  queue.release('job-1');

  // Next in queue should be job-2 (createdAt: 200)
  assert.deepEqual(executed, ['job-1', 'job-2']);

  // Completing job-2
  jobs.find((j) => j.id === 'job-2')!.stage = 'completed';
  queue.release('job-2');

  // Next should be job-3 (createdAt: 300)
  assert.deepEqual(executed, ['job-1', 'job-2', 'job-3']);
});

test('JobQueue pendingJobs() returns ordered list of queued jobs', () => {
  const jobs = [
    makeJob('c', 300),
    makeJob('a', 100),
    makeJob('b', 200),
    makeJob('done', 50, 'completed'),
  ];
  const store = createMockStore(jobs);
  const queue = new JobQueue(store, async () => {});

  const pending = queue.pendingJobs();
  assert.equal(pending.length, 3);
  assert.equal(pending[0].id, 'a');
  assert.equal(pending[1].id, 'b');
  assert.equal(pending[2].id, 'c');
});
