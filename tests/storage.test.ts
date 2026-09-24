import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { within, isAllowedOutputPath, externalDirectory } from '../electron/storage';

test('within() handles case-insensitivity on Windows and rejects traversal', () => {
  if (process.platform === 'win32') {
    assert.equal(within('C:\\ReelMind\\work', 'c:\\reelmind\\work\\job-123'), true);
    assert.equal(within('C:\\ReelMind\\work', 'c:\\reelmind\\work'), true);
    assert.equal(within('C:\\ReelMind\\work', 'c:\\reelmind\\work\\..\\secrets.txt'), false);
    assert.equal(within('C:\\ReelMind\\work', 'c:\\other\\dir'), false);
  } else {
    assert.equal(within('/tmp/reelmind/work', '/tmp/reelmind/work/job-123'), true);
    assert.equal(within('/tmp/reelmind/work', '/tmp/reelmind/work/../secrets.txt'), false);
    assert.equal(within('/tmp/reelmind/work', '/tmp/other/dir'), false);
  }
});

test('isAllowedOutputPath() allows internal paths and rejects blocked roots', () => {
  const root = path.resolve('userData');
  const blocked = [root, path.resolve('appPath')];

  const validWork = path.join(root, 'work', 'job-1', 'clip.mp4');
  const validOutput = path.join(root, 'outputs', 'job-1', 'reelmind_01.mp4');
  assert.equal(isAllowedOutputPath(validWork, root, blocked), true);
  assert.equal(isAllowedOutputPath(validOutput, root, blocked), true);

  // Blocked roots should be rejected
  const blockedApp = path.join(path.resolve('appPath'), 'evil.mp4');
  assert.equal(isAllowedOutputPath(blockedApp, root, blocked), false);

  // External non-blocked directory should be allowed
  const safeExternal = path.resolve(os.tmpdir(), 'external_exports', 'reelmind_01.mp4');
  assert.equal(isAllowedOutputPath(safeExternal, root, blocked), true);
});

test('externalDirectory() handles missing folder and blocked folder checks', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reelmind-test-storage-'));
  const blockedDir = path.join(tempDir, 'blocked');
  const safeDir = path.join(tempDir, 'safe');
  await fs.mkdir(blockedDir, { recursive: true });
  await fs.mkdir(safeDir, { recursive: true });

  try {
    // Missing directory throws clear friendly message
    const nonExistent = path.join(tempDir, 'non_existent_' + Date.now());
    await assert.rejects(
      externalDirectory(nonExistent, [blockedDir]),
      /That folder no longer exists/
    );

    // Blocked directory throws error
    await assert.rejects(
      externalDirectory(blockedDir, [blockedDir]),
      /Choose a folder outside REELMIND’s installation and internal storage/
    );

    // Safe directory succeeds
    const resolved = await externalDirectory(safeDir, [blockedDir]);
    assert.ok(resolved);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});
