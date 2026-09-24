import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { CheckpointStore } from '../electron/checkpoint';

test('CheckpointStore fingerprints data deterministically', () => {
  const store = new CheckpointStore();
  const hash1 = store.fingerprint({ a: 1, b: 'two' });
  const hash2 = store.fingerprint({ a: 1, b: 'two' });
  const hash3 = store.fingerprint({ a: 1, b: 'three' });

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
});

test('CheckpointStore caches and invalidates generated checkpoints', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reelmind-test-checkpoint-'));
  const targetFile = path.join(tempDir, 'data.json');
  const store = new CheckpointStore({} as any);

  let generateCount = 0;
  const generate = async () => {
    generateCount++;
    return { count: generateCount, text: 'hello' };
  };

  try {
    // First generation
    const val1 = await store.checkpoint(targetFile, (d: any) => typeof d.count === 'number', generate);
    assert.equal(val1.count, 1);
    assert.equal(generateCount, 1);

    // Second call with intact checkpoint uses cache
    const val2 = await store.checkpoint(targetFile, (d: any) => typeof d.count === 'number', generate);
    assert.equal(val2.count, 1);
    assert.equal(generateCount, 1);

    // Invalidate checkpoint
    await store.invalidate(targetFile);

    // Third call after invalidation regenerates
    const val3 = await store.checkpoint(targetFile, (d: any) => typeof d.count === 'number', generate);
    assert.equal(val3.count, 2);
    assert.equal(generateCount, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});
