import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { isAllowedOutputPath } from '../electron/storage';

test('protocol path validation enforces UUID jobId and two-digit reelId format', () => {
  const isValidJobId = (id: string) => /^[\da-f-]{36}$/.test(id);
  const isValidReelId = (id: string) => id === 'thumb' || /^\d{2}$/.test(id);

  assert.equal(isValidJobId('12345678-1234-1234-1234-123456789abc'), true);
  assert.equal(isValidJobId('../../../secrets'), false);
  assert.equal(isValidJobId('invalid-job-id'), false);

  assert.equal(isValidReelId('01'), true);
  assert.equal(isValidReelId('99'), true);
  assert.equal(isValidReelId('thumb'), true);
  assert.equal(isValidReelId('1'), false);
  assert.equal(isValidReelId('001'), false);
  assert.equal(isValidReelId('..'), false);
});

test('protocol handler rejects path traversal or files outside allowed output roots', () => {
  const root = path.resolve('userData');
  const appPath = path.resolve('appPath');
  const blocked = [root, appPath];

  // Allowed work and output paths
  assert.equal(isAllowedOutputPath(path.join(root, 'work', 'job-1', 'clip.mp4'), root, blocked), true);
  assert.equal(isAllowedOutputPath(path.join(root, 'outputs', 'job-1', 'reelmind_01.mp4'), root, blocked), true);

  // Traversal attempts
  assert.equal(isAllowedOutputPath(path.join(root, 'work', '..', 'secrets.txt'), root, blocked), false);
  assert.equal(isAllowedOutputPath(path.join(appPath, 'secrets.json'), root, blocked), false);

  // Safe external path
  const externalSafe = path.join(os.tmpdir(), 'SafeFolder', 'reelmind_01.mp4');
  assert.equal(isAllowedOutputPath(externalSafe, root, blocked), true);
});
