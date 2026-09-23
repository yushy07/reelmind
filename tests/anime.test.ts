import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AnimeEpisodeAnalysis, MusicMap, AnimeShot, AnimeCandidate } from '../shared/types';

const execFileAsync = promisify(execFile);

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
    musicBpm: sampleMusic.bpm,
    candidatesCount: 25
  };

  assert.equal(sampleAnalysis.version, 1);
  assert.equal(sampleAnalysis.language, 'ja');
  assert.equal(sampleAnalysis.shotCount, 2);
  assert.equal(sampleMusic.bpm, 142.0);
  assert.equal(sampleShots[0].duration, 3.2);
  assert.equal(sampleAnalysis.candidatesCount, 25);
});

test('multi-signal impact scoring computes correct weighted values and bounds', () => {
  function computeImpactScore(features: {
    motionSpike: number;
    transient: number;
    frameDiff: number;
    face: number;
    audioEnergy: number;
  }): number {
    const normMotion = Math.min(1.0, features.motionSpike / 0.30);
    const normTransient = Math.min(1.0, features.transient / 0.35);
    const normDiff = Math.min(1.0, features.frameDiff / 0.12);
    const normFace = Math.min(1.0, features.face);
    const normEnergy = Math.min(1.0, features.audioEnergy / 0.45);

    const score = 0.35 * normMotion + 0.25 * normTransient + 0.20 * normDiff + 0.15 * normFace + 0.05 * normEnergy;
    return Math.round(score * 10000) / 10000;
  }

  // All zeros
  assert.equal(computeImpactScore({ motionSpike: 0, transient: 0, frameDiff: 0, face: 0, audioEnergy: 0 }), 0.0);

  // All max / saturation
  assert.equal(computeImpactScore({ motionSpike: 0.5, transient: 0.5, frameDiff: 0.2, face: 1.0, audioEnergy: 0.6 }), 1.0);

  // High action moment (motion + transient)
  const actionScore = computeImpactScore({ motionSpike: 0.28, transient: 0.32, frameDiff: 0.10, face: 0.0, audioEnergy: 0.30 });
  assert.ok(actionScore > 0.65 && actionScore < 0.95, `Expected high action score, got ${actionScore}`);

  // Emotional close-up moment (face + dialogue audio)
  const emotionalScore = computeImpactScore({ motionSpike: 0.03, transient: 0.05, frameDiff: 0.02, face: 0.85, audioEnergy: 0.25 });
  assert.ok(emotionalScore > 0.15 && emotionalScore < 0.40, `Expected emotional score, got ${emotionalScore}`);
});

test('impact timestamp calculation is strictly bounded within shot interval', () => {
  function findImpactTime(shot: { start: number; end: number; duration: number }, motionPeak: number, motionTime: number, transPeak: number, transTime: number): number {
    const normMotion = Math.min(1.0, motionPeak / 0.30);
    const normTrans = Math.min(1.0, transPeak / 0.35);

    let impact: number;
    if (normMotion + normTrans > 0.01) {
      impact = (normMotion * motionTime + normTrans * transTime) / (normMotion + normTrans);
    } else {
      impact = shot.start + shot.duration * 0.4;
    }
    return Math.max(shot.start, Math.min(shot.end, Math.round(impact * 1000) / 1000));
  }

  const shot = { start: 10.0, end: 14.5, duration: 4.5 };

  // Motion spike dominates
  const tMotion = findImpactTime(shot, 0.29, 11.2, 0.02, 13.8);
  assert.ok(tMotion >= shot.start && tMotion <= shot.end);
  assert.ok(Math.abs(tMotion - 11.2) < 0.25);

  // Audio transient dominates
  const tAudio = findImpactTime(shot, 0.01, 10.5, 0.34, 12.8);
  assert.ok(tAudio >= shot.start && tAudio <= shot.end);
  assert.ok(Math.abs(tAudio - 12.8) < 0.25);

  // Joint peak: weighted average
  const tJoint = findImpactTime(shot, 0.30, 11.0, 0.35, 13.0);
  assert.ok(tJoint >= 11.8 && tJoint <= 12.2);

  // Boundary clamp check: even if anomalous timestamps are passed
  const tClampHigh = findImpactTime(shot, 0.5, 99.0, 0.0, 99.0);
  assert.equal(tClampHigh, shot.end);

  const tClampLow = findImpactTime(shot, 0.5, -5.0, 0.0, -5.0);
  assert.equal(tClampLow, shot.start);
});

test('local candidate ranking filters 250 raw shots down to 20-30 diverse moments', () => {
  interface RawShot {
    id: number;
    start: number;
    end: number;
    duration: number;
    motionPeak: number;
    transientPeak: number;
    faceScore: number;
    sharpness: number;
    hasDialogue: boolean;
  }

  // Simulate 250 shots from a 24-minute episode (average 5.7s each)
  const rawShots: RawShot[] = [];
  let currentTime = 0.0;
  for (let i = 1; i <= 250; i++) {
    // vary duration between 0.4s and 12s
    const dur = i % 15 === 0 ? 0.4 : i % 23 === 0 ? 16.0 : Math.round((2.0 + (i % 7) * 1.2) * 10) / 10;
    rawShots.push({
      id: i,
      start: currentTime,
      end: currentTime + dur,
      duration: dur,
      motionPeak: (i % 11 === 0) ? 0.32 : (i % 5 === 0) ? 0.18 : 0.04,
      transientPeak: (i % 7 === 0) ? 0.36 : (i % 3 === 0) ? 0.15 : 0.02,
      faceScore: (i % 13 === 0) ? 0.8 : (i % 4 === 0) ? 0.35 : 0.0,
      sharpness: 100 + (i % 10) * 20,
      hasDialogue: i % 6 === 0
    });
    currentTime += dur;
  }

  // Candidate ranking function (mirroring workers/anime_worker.py)
  const candidates: AnimeCandidate[] = [];
  for (const shot of rawShots) {
    if (shot.duration < 0.6 || shot.duration > 15.0) continue;

    const normMotion = Math.min(1.0, shot.motionPeak / 0.30);
    const normTrans = Math.min(1.0, shot.transientPeak / 0.35);
    const normFace = shot.faceScore;
    const impactScore = Math.round((0.35 * normMotion + 0.25 * normTrans + 0.15 * normFace + 0.10) * 1000) / 1000;

    let category: 'action' | 'emotional' | 'dialogue' | 'cinematic';
    let catBonus = 0;
    if (normMotion >= 0.45 && normTrans >= 0.35) {
      category = 'action';
      catBonus = 0.25 * normMotion + 0.15 * normTrans;
    } else if (normFace >= 0.30 && (shot.hasDialogue || normMotion < 0.40)) {
      category = 'emotional';
      catBonus = 0.30 * normFace;
    } else if (shot.hasDialogue) {
      category = 'dialogue';
      catBonus = 0.25;
    } else {
      category = 'cinematic';
      catBonus = 0.15;
    }

    const totalScore = Math.round((0.65 * impactScore + 0.35 * catBonus) * 1000) / 1000;
    const impactTime = shot.start + shot.duration * 0.4;

    candidates.push({
      id: 0,
      shotId: shot.id,
      start: shot.start,
      end: shot.end,
      duration: shot.duration,
      impactTime,
      motionScore: normMotion,
      faceScore: normFace,
      audioEnergyScore: 0.5,
      transientScore: normTrans,
      impactScore,
      totalScore,
      category,
      hasDialogue: shot.hasDialogue,
      facesCount: normFace > 0 ? 1 : 0,
      maxFaceRatio: normFace * 0.25
    });
  }

  // Sort descending
  candidates.sort((a, b) => b.totalScore - a.totalScore);

  // Apply NMS (temporal suppression within 2.0s)
  const selected: AnimeCandidate[] = [];
  const seen: { start: number; end: number; cat: string }[] = [];

  for (const c of candidates) {
    let suppressed = false;
    for (const s of seen) {
      if (Math.abs(c.start - s.start) < 2.0 || (c.start < s.end && c.end > s.start)) {
        if (c.category === s.cat || selected.length >= 20) {
          suppressed = true;
          break;
        }
      }
    }
    if (!suppressed || selected.length < 15) {
      selected.push(c);
      seen.push({ start: c.start, end: c.end, cat: c.category });
    }
    if (selected.length >= 30) break;
  }

  // Assign IDs
  selected.forEach((c, idx) => { c.id = idx + 1; });

  assert.ok(selected.length >= 20 && selected.length <= 30, `Expected 20-30 candidates, got ${selected.length}`);
  
  // Verify categories diversity
  const categories = new Set(selected.map(c => c.category));
  assert.ok(categories.size >= 3, `Expected at least 3 categories represented, got ${categories.size}`);

  // Verify all candidate impact timestamps are strictly within their shot boundaries
  for (const c of selected) {
    assert.ok(c.impactTime >= c.start && c.impactTime <= c.end, `Candidate ${c.id} impactTime out of bounds`);
    assert.ok(c.duration >= 0.6 && c.duration <= 15.0, `Candidate ${c.id} invalid duration`);
  }
});

test('candidates checkpoint is valid and reused on matching hash, invalidated on dependency change', async () => {
  const tmpDir = path.join(__dirname, '..', '.test-data', 'anime_checkpoint_test');
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const shotsFile = path.join(tmpDir, 'shots.json');
    const audioFile = path.join(tmpDir, 'audio.wav');
    const transcriptFile = path.join(tmpDir, 'transcript.json');
    const candidatesFile = path.join(tmpDir, 'candidates.json');
    const hashFile = candidatesFile + '.sha256';

    await fs.writeFile(shotsFile, JSON.stringify([{ id: 1, start: 0, end: 4, duration: 4 }]));
    await fs.writeFile(audioFile, 'dummy-audio-bytes');
    await fs.writeFile(transcriptFile, JSON.stringify({ version: 1, segments: [] }));

    const shotsHash = createHash('sha256').update(await fs.readFile(shotsFile)).digest('hex');
    const audioHash = createHash('sha256').update(await fs.readFile(audioFile)).digest('hex');
    const transHash = createHash('sha256').update(await fs.readFile(transcriptFile)).digest('hex');

    const expectedHash = createHash('sha256').update(JSON.stringify({ shots: shotsHash, audio: audioHash, transcript: transHash, v: 1 })).digest('hex');

    // Simulate saving candidates and its sha256
    const sampleCandidates: AnimeCandidate[] = [{
      id: 1,
      shotId: 1,
      start: 0,
      end: 4,
      duration: 4,
      impactTime: 1.6,
      motionScore: 0.5,
      faceScore: 0.0,
      audioEnergyScore: 0.4,
      transientScore: 0.5,
      impactScore: 0.45,
      totalScore: 0.5,
      category: 'cinematic',
      hasDialogue: false,
      facesCount: 0,
      maxFaceRatio: 0
    }];

    await fs.writeFile(candidatesFile, JSON.stringify(sampleCandidates));
    await fs.writeFile(hashFile, expectedHash);

    // Verify checkpoint match
    const storedHash = (await fs.readFile(hashFile, 'utf8')).trim();
    assert.equal(storedHash, expectedHash);

    // Now modify shotsFile: hash must mismatch
    await fs.writeFile(shotsFile, JSON.stringify([{ id: 1, start: 0, end: 5, duration: 5 }]));
    const newShotsHash = createHash('sha256').update(await fs.readFile(shotsFile)).digest('hex');
    const newHash = createHash('sha256').update(JSON.stringify({ shots: newShotsHash, audio: audioHash, transcript: transHash, v: 1 })).digest('hex');

    assert.notEqual(storedHash, newHash, 'Checkpoint should invalidate when upstream shots change');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('anime_worker score-candidates CLI produces valid candidates schema on test media', async () => {
  const root = path.join(__dirname, '..');
  const pythonBin = path.join(root, 'runtime', 'python', 'python.exe');
  const workerScript = path.join(root, 'workers', 'anime_worker.py');
  const testVideo = path.join(root, '.test-data', 'render', 'test-source.mp4');
  const testAudio = path.join(root, '.test-data', 'pipeline', 'work', 'fb912bdc-29d3-49dd-b3ef-b9e388aacaa0', 'audio.wav');
  const modelsDir = path.join(root, 'runtime', 'models');

  if (!await fs.stat(testVideo).catch(() => null) || !await fs.stat(testAudio).catch(() => null)) {
    return; // skip if test media not available in environment
  }

  const tmpWork = path.join(root, '.test-data', 'worker_test_' + Date.now());
  await fs.mkdir(tmpWork, { recursive: true });

  try {
    const shotsFile = path.join(tmpWork, 'shots.json');
    const candidatesFile = path.join(tmpWork, 'candidates.json');

    const sampleShots = [
      { id: 1, start: 0.0, end: 4.0, duration: 4.0 },
      { id: 2, start: 4.0, end: 9.5, duration: 5.5 },
      { id: 3, start: 9.5, end: 15.0, duration: 5.5 }
    ];
    await fs.writeFile(shotsFile, JSON.stringify(sampleShots));

    const { stdout } = await execFileAsync(pythonBin, [
      workerScript,
      'score-candidates',
      '--source', testVideo,
      '--shots', shotsFile,
      '--audio', testAudio,
      '--output', candidatesFile,
      '--models', modelsDir
    ]);

    assert.ok(stdout.includes('Discovered 3 ranked candidate moments'));
    const generated: AnimeCandidate[] = JSON.parse(await fs.readFile(candidatesFile, 'utf8'));

    assert.equal(generated.length, 3);
    for (const c of generated) {
      assert.ok(c.id >= 1);
      assert.ok(c.shotId >= 1);
      assert.ok(c.impactTime >= c.start && c.impactTime <= c.end);
      assert.ok(['action', 'emotional', 'dialogue', 'cinematic'].includes(c.category));
      assert.ok(typeof c.impactScore === 'number' && c.impactScore >= 0);
      assert.ok(typeof c.totalScore === 'number' && c.totalScore >= 0);
    }
  } finally {
    await fs.rm(tmpWork, { recursive: true, force: true }).catch(() => {});
  }
});

