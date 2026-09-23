import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AnimeEpisodeAnalysis, MusicMap, AnimeShot } from '../shared/types';

test('shared transcription and anime worker scripts exist', async () => {
  const root = path.join(__dirname, '..');
  const sharedTrans = path.join(root, 'workers', 'shared', 'transcription.py');
  const animeWorker = path.join(root, 'workers', 'anime_worker.py');
  const podcastWorker = path.join(root, 'workers', 'worker.py');

  assert.equal(!!await fs.stat(sharedTrans).catch(() => null), true);
  assert.equal(!!await fs.stat(animeWorker).catch(() => null), true);
  assert.equal(!!await fs.stat(podcastWorker).catch(() => null), true);
});

test('anime data structures conform to analysis database contract', () => {
  const sampleShots: AnimeShot[] = [
    { id: 1, start: 0.0, end: 3.2, duration: 3.2, keyframeTime: 1.28 },
    { id: 2, start: 3.2, end: 7.5, duration: 4.3, keyframeTime: 4.92 }
  ];

  const sampleMusic: MusicMap = {
    duration: 180.5,
    bpm: 142.0,
    beats: [0.42, 0.84, 1.26, 1.68],
    strongBeats: [0.84, 1.68],
    energySections: [{ start: 0, end: 2, energy: 0.45 }]
  };

  const sampleAnalysis: AnimeEpisodeAnalysis = {
    version: 1,
    metadata: {
      duration: 1420.0,
      width: 1920,
      height: 1080,
      fps: 23.976,
      videoCodec: 'h264',
      audioCodec: 'aac'
    },
    language: 'ja',
    shotCount: sampleShots.length,
    dialogueCount: 42,
    musicBpm: sampleMusic.bpm
  };

  assert.equal(sampleAnalysis.version, 1);
  assert.equal(sampleAnalysis.language, 'ja');
  assert.equal(sampleAnalysis.shotCount, 2);
  assert.equal(sampleMusic.bpm, 142.0);
  assert.equal(sampleShots[0].duration, 3.2);
});
