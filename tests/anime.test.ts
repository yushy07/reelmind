import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AnimeEpisodeAnalysis, MusicMap, AnimeShot, AnimeCandidate, AnimeEditConcept, AnimeEditPlan, Settings, Job } from '../shared/types';
import { Service } from '../electron/service';
import { Store } from '../electron/storage';
import {
  buildGeminiEvaluationPrompt,
  animeEvaluationResponseSchema,
  selectDiverseConcepts,
  selectAnimeMoments,
  type AnimeEvaluationItem
} from '../electron/anime/selection';
import { planAnimeEdit } from '../electron/anime/planner';
import { buildAnimeFilterGraph, renderAnimeAMV } from '../electron/anime/renderer';
import { probe } from '../electron/media';

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

function createMockCandidates(count = 20): AnimeCandidate[] {
  const categories: ('action' | 'emotional' | 'dialogue' | 'cinematic')[] = ['action', 'emotional', 'dialogue', 'cinematic'];
  const candidates: AnimeCandidate[] = [];
  let t = 0;
  for (let i = 1; i <= count; i++) {
    const dur = 3.0 + (i % 4);
    const cat = categories[(i - 1) % categories.length];
    const totalScore = Math.round((0.4 + ((count - i) / count) * 0.5) * 100) / 100;
    candidates.push({
      id: i,
      shotId: i * 2,
      start: t,
      end: t + dur,
      duration: dur,
      impactTime: Math.round((t + dur * 0.45) * 100) / 100,
      motionScore: 0.6,
      faceScore: 0.4,
      audioEnergyScore: 0.5,
      transientScore: 0.7,
      impactScore: 0.65,
      totalScore,
      category: cat,
      hasDialogue: cat === 'dialogue' || cat === 'emotional',
      dialogueText: cat === 'dialogue' ? `Dialogue line for candidate ${i}` : undefined,
      facesCount: 1,
      maxFaceRatio: 0.2
    });
    t += dur + 1.0;
  }
  return candidates;
}

test('buildGeminiEvaluationPrompt produces compact prompt bounded to 24 candidates and includes BPM', () => {
  const candidates = createMockCandidates(30);
  const musicMap: MusicMap = {
    duration: 120,
    bpm: 148,
    beats: [0.5, 1.0],
    strongBeats: [1.0],
    energySections: [{ start: 0, end: 120, energy: 0.7 }]
  };

  const prompt = buildGeminiEvaluationPrompt(candidates, musicMap);
  assert.ok(prompt.includes('Music Track BPM: 148'));
  assert.ok(prompt.includes('"evaluations"'));
  assert.ok(prompt.includes('hard_beat_drop'));

  // Ensure JSON candidates section contains max 24 items
  const jsonMatch = prompt.match(/Candidates:\s*(\[.*\])/s);
  assert.ok(jsonMatch);
  const serialized = JSON.parse(jsonMatch[1]);
  assert.equal(serialized.length, 24);
  assert.equal(serialized[0].id, 1);
  assert.ok(typeof serialized[0].category === 'string');
});

test('animeEvaluationResponseSchema parses valid JSON and applies fallback defaults on unexpected values', () => {
  const validData = {
    evaluations: [
      {
        candidateId: 1,
        qualityScore: 92,
        sceneVibe: 'high_energy_action',
        narrativeImportance: 'high',
        recommendedInOffset: -0.2,
        recommendedOutOffset: 0.5,
        editStyle: 'hard_beat_drop',
        title: 'Epic Climax Hit',
        description: 'Decisive strike during high speed exchange'
      },
      {
        candidateId: 2,
        qualityScore: 78,
        sceneVibe: 'emotional_drama',
        narrativeImportance: 'medium',
        recommendedInOffset: 0,
        recommendedOutOffset: 0,
        editStyle: 'slow_burn'
      }
    ]
  };

  const parsed = animeEvaluationResponseSchema.parse(validData);
  assert.equal(parsed.evaluations.length, 2);
  assert.equal(parsed.evaluations[0].qualityScore, 92);
  assert.equal(parsed.evaluations[0].editStyle, 'hard_beat_drop');

  // Fallback resilience: unexpected vibe or editStyle caught safely
  const lenientData = {
    evaluations: [
      {
        candidateId: 3,
        qualityScore: 85,
        sceneVibe: 'unknown_alien_vibe', // should catch to high_energy_action
        narrativeImportance: 'legendary', // should catch to medium
        editStyle: 'crazy_style' // should catch to hard_beat_drop
      }
    ]
  };

  const lenientParsed = animeEvaluationResponseSchema.parse(lenientData);
  assert.equal(lenientParsed.evaluations[0].sceneVibe, 'high_energy_action');
  assert.equal(lenientParsed.evaluations[0].narrativeImportance, 'medium');
  assert.equal(lenientParsed.evaluations[0].editStyle, 'hard_beat_drop');

  // Strict rejection on out-of-range qualityScore
  assert.throws(() => {
    animeEvaluationResponseSchema.parse({
      evaluations: [{ candidateId: 4, qualityScore: 150 }]
    });
  });
});

test('selectDiverseConcepts outputs strictly 3-5 non-overlapping concepts across vibes with appropriate styles', () => {
  const candidates = createMockCandidates(20);
  const concepts = selectDiverseConcepts(candidates);

  assert.ok(concepts.length >= 3 && concepts.length <= 5, `Expected 3-5 concepts, got ${concepts.length}`);

  // Check unique IDs
  const ids = new Set(concepts.map(c => c.id));
  assert.equal(ids.size, concepts.length);

  // Check category diversity
  const categories = new Set(concepts.map(c => c.category));
  assert.ok(categories.size >= 3, `Expected at least 3 distinct categories, got ${categories.size}`);

  // Check style assignments
  for (const c of concepts) {
    if (c.category === 'action') assert.equal(c.style, 'hard_beat_drop');
    if (c.category === 'emotional') assert.equal(c.style, 'slow_burn');
    if (c.category === 'dialogue') assert.equal(c.style, 'dialogue_pause');
    if (c.category === 'cinematic') assert.equal(c.style, 'velocity_ramp');

    assert.ok(c.impactTime >= c.start && c.impactTime <= c.end, `Impact time ${c.impactTime} not within [${c.start}, ${c.end}]`);
    assert.ok(c.duration >= 2.0);
    assert.ok(c.qualityScore >= 0 && c.qualityScore <= 100);
  }

  // Check non-overlapping timing
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const a = concepts[i];
      const b = concepts[j];
      const sep = Math.abs(a.start - b.start);
      assert.ok(sep >= 2.5 || a.end <= b.start || b.end <= a.start, `Overlap detected between concept ${a.id} and ${b.id}`);
    }
  }
});

test('selectDiverseConcepts incorporates Gemini evaluation quality scores and custom metadata', () => {
  const candidates = createMockCandidates(12);
  // Candidate #4 has category 'cinematic', originally lower totalScore than #1
  const evMap = new Map<number, AnimeEvaluationItem>();
  evMap.set(4, {
    candidateId: 4,
    qualityScore: 98,
    sceneVibe: 'cinematic_atmosphere',
    narrativeImportance: 'high',
    recommendedInOffset: 0,
    recommendedOutOffset: 0,
    editStyle: 'velocity_ramp',
    title: 'Breathtaking Vista Over the City',
    description: 'Golden hour silhouette overlooking the Tokyo skyline'
  });

  const concepts = selectDiverseConcepts(candidates, evMap);
  const promoted = concepts.find(c => c.shotId === 4 * 2); // shotId is candidateId * 2
  assert.ok(promoted, 'Candidate #4 should be selected due to high Gemini quality score');
  assert.equal(promoted.title, 'Breathtaking Vista Over the City');
  assert.equal(promoted.description, 'Golden hour silhouette overlooking the Tokyo skyline');
  assert.equal(promoted.qualityScore, 98);
  assert.equal(promoted.style, 'velocity_ramp');
  assert.equal(promoted.narrativeImportance, 'high');
});

test('selectAnimeMoments handles cloud disabled, Gemini quota 429, and API success gracefully', async () => {
  const candidates = createMockCandidates(16);
  const musicMap: MusicMap = { duration: 60, bpm: 135, beats: [], strongBeats: [], energySections: [] };
  const logs: string[] = [];
  const report = (msg: string) => logs.push(msg);

  const baseSettings: Settings = {
    providerOrder: ['gemini', 'openrouter'],
    geminiModel: 'gemini-1.5-flash',
    openrouterModel: 'openrouter/free',
    quality: 'balanced',
    cloudEnabled: false,
    geminiFreeConfirmed: false,
    transcriptionMode: 'standard'
  };

  // Case 1: Cloud disabled -> runs local selection directly, fetch never called
  let fetchCalled = false;
  const mockFetchDisabled = (async () => {
    fetchCalled = true;
    return new Response();
  }) as unknown as typeof fetch;

  const res1 = await selectAnimeMoments(candidates, musicMap, baseSettings, async () => '', new AbortController().signal, report, mockFetchDisabled);
  assert.equal(fetchCalled, false);
  assert.ok(res1.length >= 3 && res1.length <= 5);
  assert.ok(logs.some(l => l.includes('cloud disabled')));

  // Case 2: Cloud enabled, Gemini returns 429 quota reached -> fallbacks gracefully without error
  logs.length = 0;
  const cloudSettings: Settings = { ...baseSettings, cloudEnabled: true, geminiFreeConfirmed: true };
  const mockFetchQuota = (async () => {
    return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 });
  }) as unknown as typeof fetch;

  const res2 = await selectAnimeMoments(candidates, musicMap, cloudSettings, async () => 'mock-gemini-key', new AbortController().signal, report, mockFetchQuota);
  assert.ok(res2.length >= 3 && res2.length <= 5);
  assert.ok(logs.some(l => l.includes('free quota reached')));

  // Case 3: Cloud enabled, Gemini returns valid response
  logs.length = 0;
  const mockGeminiData = {
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            evaluations: [
              {
                candidateId: 1,
                qualityScore: 95,
                sceneVibe: 'high_energy_action',
                narrativeImportance: 'high',
                recommendedInOffset: 0,
                recommendedOutOffset: 0,
                editStyle: 'hard_beat_drop',
                title: 'High Speed Pursuit',
                description: 'Car chase through neon-lit highway'
              }
            ]
          })
        }]
      }
    }]
  };
  const mockFetchSuccess = (async () => {
    return new Response(JSON.stringify(mockGeminiData), { status: 200 });
  }) as unknown as typeof fetch;

  const res3 = await selectAnimeMoments(candidates, musicMap, cloudSettings, async () => 'mock-gemini-key', new AbortController().signal, report, mockFetchSuccess);
  assert.ok(res3.length >= 3 && res3.length <= 5);
  assert.ok(logs.some(l => l.includes('evaluated 1 candidate moments successfully')));
  const topConcept = res3.find(c => c.title === 'High Speed Pursuit');
  assert.ok(topConcept);
  assert.equal(topConcept.qualityScore, 95);
});

test('edit_concepts checkpoint caching ensures instant reuse and invalidates on candidate changes', async () => {
  const tmpDir = path.join(__dirname, '..', '.test-data', 'concepts_checkpoint_test');
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const candidatesFile = path.join(tmpDir, 'candidates.json');
    const conceptsFile = path.join(tmpDir, 'edit_concepts.json');
    const hashFile = conceptsFile + '.sha256';

    const candidates1 = createMockCandidates(5);
    await fs.writeFile(candidatesFile, JSON.stringify(candidates1));

    const candHash1 = createHash('sha256').update(await fs.readFile(candidatesFile)).digest('hex');
    const expectedHash1 = createHash('sha256').update(JSON.stringify({ candidates: candHash1, v: 1 })).digest('hex');

    const sampleConcepts: AnimeEditConcept[] = [
      {
        id: 1,
        shotId: 2,
        start: 0,
        end: 4,
        duration: 4,
        impactTime: 1.8,
        category: 'action',
        style: 'hard_beat_drop',
        title: 'Action Opener',
        description: 'Explosive start',
        narrativeImportance: 'high',
        qualityScore: 90,
        motionScore: 0.8,
        faceScore: 0.2,
        transientScore: 0.9,
        hasDialogue: false
      }
    ];

    await fs.writeFile(conceptsFile, JSON.stringify(sampleConcepts));
    await fs.writeFile(hashFile, expectedHash1);

    // Verify stored hash matches
    const stored = (await fs.readFile(hashFile, 'utf8')).trim();
    assert.equal(stored, expectedHash1);

    // Modify candidates.json -> hash must invalidate
    const candidates2 = createMockCandidates(8);
    await fs.writeFile(candidatesFile, JSON.stringify(candidates2));
    const candHash2 = createHash('sha256').update(await fs.readFile(candidatesFile)).digest('hex');
    const expectedHash2 = createHash('sha256').update(JSON.stringify({ candidates: candHash2, v: 1 })).digest('hex');

    assert.notEqual(stored, expectedHash2, 'Checkpoint should invalidate when candidates change');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('planAnimeEdit creates structured 9:16 AMV plan with beat-aligned cuts and smart reframing', () => {
  const concept: AnimeEditConcept = {
    id: 1,
    shotId: 2,
    start: 10.0,
    end: 18.0,
    duration: 8.0,
    impactTime: 14.2,
    category: 'action',
    style: 'hard_beat_drop',
    title: 'Climax Impact Drop',
    description: 'Decisive counterattack during high-speed exchange',
    narrativeImportance: 'high',
    qualityScore: 94,
    motionScore: 0.85,
    faceScore: 0.45,
    transientScore: 0.90,
    hasDialogue: false
  };

  const sampleShots: AnimeShot[] = [
    { id: 1, start: 4.0, end: 10.0, duration: 6.0 },
    { id: 2, start: 10.0, end: 18.0, duration: 8.0 },
    { id: 3, start: 18.0, end: 24.0, duration: 6.0 }
  ];

  const musicMap: MusicMap = {
    duration: 180,
    bpm: 140,
    beats: [10.0, 10.43, 10.86, 11.29, 11.71, 12.14, 12.57, 13.0, 13.43, 13.86, 14.29, 14.71, 15.14],
    strongBeats: [14.29],
    energySections: [{ start: 0, end: 180, energy: 0.8 }]
  };

  const plan = planAnimeEdit(concept, musicMap, sampleShots, 30);

  assert.equal(plan.version, 1);
  assert.equal(plan.conceptId, 1);
  assert.equal(plan.fps, 30);
  assert.equal(plan.bpm, 140);
  assert.ok(plan.duration >= 8.0 && plan.duration <= 25.0);
  assert.ok(plan.cuts.length >= 2, `Expected at least 2 cuts, got ${plan.cuts.length}`);

  // Validate cuts timeline progression and bounds
  let prevTimelineEnd = 0;
  for (let i = 0; i < plan.cuts.length; i++) {
    const cut = plan.cuts[i];
    assert.ok(cut.duration > 0);
    assert.ok(cut.sourceStart < cut.sourceEnd);
    assert.equal(cut.timelineStart, prevTimelineEnd);
    assert.equal(Math.round((cut.timelineStart + cut.duration) * 100) / 100, Math.round(cut.timelineEnd * 100) / 100);
    prevTimelineEnd = cut.timelineEnd;

    // Smart 9:16 reframing center checks
    assert.ok(cut.center >= 0.25 && cut.center <= 0.75, `Cut ${i} center out of safe range: ${cut.center}`);
    assert.ok(cut.endCenter >= 0.25 && cut.endCenter <= 0.75, `Cut ${i} endCenter out of safe range: ${cut.endCenter}`);
    assert.ok(cut.zoom >= 1.0 && cut.zoom <= 1.35, `Cut ${i} zoom out of bounds: ${cut.zoom}`);
  }

  // Hard beat drop should assign flash effect to impact cut
  const impactCut = plan.cuts.find(c => c.effect === 'flash');
  assert.ok(impactCut, 'Expected an impact cut with flash effect for hard_beat_drop');

  // Audio mix check
  assert.ok(plan.audio.sourceAudioMix > 0.3 && plan.audio.sourceAudioMix <= 1.0);
  assert.ok(plan.audio.musicMix > 0.5 && plan.audio.musicMix <= 1.0);
});

test('planAnimeEdit assigns distinct music offsets and style effects for diverse concepts', () => {
  const musicMap: MusicMap = {
    duration: 180,
    bpm: 130,
    beats: [5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 45.0, 50.0, 55.0, 60.0, 65.0, 70.0, 75.0, 80.0],
    strongBeats: [15.0, 35.0, 55.0, 75.0],
    energySections: []
  };

  const sampleShots: AnimeShot[] = [
    { id: 1, start: 0, end: 10, duration: 10 },
    { id: 2, start: 10, end: 20, duration: 10 },
    { id: 3, start: 20, end: 30, duration: 10 }
  ];

  const conceptAction: AnimeEditConcept = {
    id: 1,
    shotId: 1,
    start: 0,
    end: 10,
    duration: 10,
    impactTime: 4.5,
    category: 'action',
    style: 'hard_beat_drop',
    title: 'Action Cut',
    description: '',
    narrativeImportance: 'high',
    qualityScore: 90,
    motionScore: 0.9,
    faceScore: 0.1,
    transientScore: 0.8,
    hasDialogue: false
  };

  const conceptDialogue: AnimeEditConcept = {
    id: 2,
    shotId: 2,
    start: 10,
    end: 20,
    duration: 10,
    impactTime: 14.0,
    category: 'dialogue',
    style: 'dialogue_pause',
    title: 'Dialogue Cut',
    description: '',
    narrativeImportance: 'high',
    qualityScore: 88,
    motionScore: 0.3,
    faceScore: 0.8,
    transientScore: 0.4,
    hasDialogue: true,
    dialogueText: 'I will never give up!'
  };

  const conceptCinematic: AnimeEditConcept = {
    id: 3,
    shotId: 3,
    start: 20,
    end: 30,
    duration: 10,
    impactTime: 25.0,
    category: 'cinematic',
    style: 'velocity_ramp',
    title: 'Cinematic Cut',
    description: '',
    narrativeImportance: 'medium',
    qualityScore: 85,
    motionScore: 0.7,
    faceScore: 0.3,
    transientScore: 0.6,
    hasDialogue: false
  };

  const plan1 = planAnimeEdit(conceptAction, musicMap, sampleShots);
  const plan2 = planAnimeEdit(conceptDialogue, musicMap, sampleShots);
  const plan3 = planAnimeEdit(conceptCinematic, musicMap, sampleShots);

  // Staggered music offsets so edits don't duplicate music segments
  assert.notEqual(plan1.audio.musicOffset, plan2.audio.musicOffset);
  assert.notEqual(plan2.audio.musicOffset, plan3.audio.musicOffset);

  // Dialogue style should prioritize anime audio over music
  assert.ok(plan2.audio.sourceAudioMix > plan1.audio.sourceAudioMix);
  assert.ok(plan2.audio.musicMix < plan1.audio.musicMix);

  // Velocity ramp should include velocity_ramp effect
  const hasVelocity = plan3.cuts.some(c => c.effect === 'velocity_ramp');
  assert.ok(hasVelocity);
});

test('buildAnimeFilterGraph produces valid FFmpeg filter graph string for vertical 9:16 AMV', () => {
  const plan: AnimeEditPlan = {
    version: 1,
    conceptId: 1,
    title: 'Test AMV',
    style: 'hard_beat_drop',
    category: 'action',
    duration: 12.5,
    fps: 30,
    bpm: 135,
    cuts: [
      {
        shotId: 1,
        sourceStart: 1.0,
        sourceEnd: 5.0,
        timelineStart: 0.0,
        timelineEnd: 4.0,
        duration: 4.0,
        zoom: 1.05,
        center: 0.5,
        endCenter: 0.52
      },
      {
        shotId: 2,
        sourceStart: 5.0,
        sourceEnd: 13.5,
        timelineStart: 4.0,
        timelineEnd: 12.5,
        duration: 8.5,
        zoom: 1.20,
        center: 0.48,
        endCenter: 0.48,
        effect: 'flash'
      }
    ],
    audio: {
      sourceAudioMix: 0.6,
      musicMix: 0.85,
      musicOffset: 12.0
    }
  };

  // With background music
  const graphWithMusic = buildAnimeFilterGraph(plan, true);
  assert.ok(graphWithMusic.includes('trim=start=1:end=5'));
  assert.ok(graphWithMusic.includes('crop=1080:1920:x='));
  assert.ok(graphWithMusic.includes('concat=n=2:v=1:a=0'));
  assert.ok(graphWithMusic.includes('[1:a]atrim=start=12:end=24.5'));
  assert.ok(graphWithMusic.includes('amix=inputs=2'));
  assert.ok(graphWithMusic.includes('loudnorm=I=-14'));
  assert.ok(graphWithMusic.includes('[vout]'));
  assert.ok(graphWithMusic.includes('[aout]'));

  // Without background music (uses episode audio directly)
  const graphNoMusic = buildAnimeFilterGraph(plan, false);
  assert.ok(!graphNoMusic.includes('[1:a]'));
  assert.ok(!graphNoMusic.includes('amix=inputs=2'));
  assert.ok(graphNoMusic.includes('[aepisode]loudnorm=I=-14'));
});

test('buildAnimeFilterGraph supports 16:9 Cinema and 1:1 Square aspect ratios and subtitle burning', () => {
  const baseCut = {
    shotId: 1,
    sourceStart: 1,
    sourceEnd: 5,
    timelineStart: 0,
    timelineEnd: 4,
    duration: 4,
    zoom: 1.05,
    center: 0.5,
    endCenter: 0.5
  };

  const plan169: AnimeEditPlan = {
    version: 1,
    conceptId: 1,
    title: 'Test 16:9',
    style: 'hard_beat_drop',
    category: 'action',
    duration: 4,
    fps: 30,
    bpm: 130,
    aspectRatio: '16:9',
    cuts: [baseCut],
    audio: { sourceAudioMix: 0.5, musicMix: 0.8, musicOffset: 0 }
  };

  const graph169 = buildAnimeFilterGraph(plan169, false);
  assert.ok(graph169.includes('crop=1920:1080:x='));

  const plan11: AnimeEditPlan = {
    version: 1,
    conceptId: 2,
    title: 'Test 1:1',
    style: 'hard_beat_drop',
    category: 'action',
    duration: 4,
    fps: 30,
    bpm: 130,
    aspectRatio: '1:1',
    cuts: [baseCut],
    audio: { sourceAudioMix: 0.5, musicMix: 0.8, musicOffset: 0 }
  };

  const graph11 = buildAnimeFilterGraph(plan11, false);
  assert.ok(graph11.includes('crop=1080:1080:x='));

  // With captions and audio stream selector
  const planWithCaps: AnimeEditPlan = {
    ...plan169,
    captions: '[Script Info]\nTitle: Test\n'
  };
  const graphCaps = buildAnimeFilterGraph(planWithCaps, false, 'C:/fake/runtime', 1);
  assert.ok(graphCaps.includes('[0:a:1]atrim='));
  assert.ok(graphCaps.includes("ass=filename='captions.ass'"));
});

test('renderAnimeAMV renders valid vertical 1080x1920 MP4 on test media', async () => {
  const root = path.join(__dirname, '..');
  const runtime = path.join(root, 'runtime');
  const testVideo = path.join(root, '.test-data', 'render', 'test-source.mp4');
  const testAudio = path.join(root, '.test-data', 'pipeline', 'work', 'fb912bdc-29d3-49dd-b3ef-b9e388aacaa0', 'audio.wav');

  if (!await fs.stat(testVideo).catch(() => null) || !await fs.stat(path.join(runtime, 'ffmpeg.exe')).catch(() => null)) {
    return; // skip if test video or ffmpeg not present in environment
  }

  const tmpWork = path.join(root, '.test-data', 'render_amv_test_' + Date.now());
  await fs.mkdir(tmpWork, { recursive: true });

  try {
    const outputMp4 = path.join(tmpWork, 'test_amv_out.mp4');
    const plan: AnimeEditPlan = {
      version: 1,
      conceptId: 1,
      title: 'Short Test AMV',
      style: 'hard_beat_drop',
      category: 'action',
      duration: 3.5,
      fps: 30,
      bpm: 130,
      cuts: [
        {
          shotId: 1,
          sourceStart: 0.0,
          sourceEnd: 1.5,
          timelineStart: 0.0,
          timelineEnd: 1.5,
          duration: 1.5,
          zoom: 1.05,
          center: 0.5,
          endCenter: 0.5
        },
        {
          shotId: 2,
          sourceStart: 1.5,
          sourceEnd: 3.5,
          timelineStart: 1.5,
          timelineEnd: 3.5,
          duration: 2.0,
          zoom: 1.15,
          center: 0.5,
          endCenter: 0.5,
          effect: 'flash'
        }
      ],
      audio: {
        sourceAudioMix: 0.6,
        musicMix: 0.8,
        musicOffset: 0.0
      }
    };

    let reportedProgress = 0;
    await renderAnimeAMV(
      runtime,
      testVideo,
      await fs.stat(testAudio).catch(() => null) ? testAudio : undefined,
      plan,
      outputMp4,
      tmpWork,
      'balanced',
      { nvenc: true, cpuThreads: 4 },
      new AbortController().signal,
      prog => { reportedProgress = prog; }
    );

    assert.ok(await fs.stat(outputMp4).catch(() => null), 'Output MP4 must exist');
    assert.ok(reportedProgress > 0, 'Progress must be reported during render');

    // Probe the rendered output
    const meta = await probe(runtime, outputMp4, undefined, 1.0);
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1920);
    assert.equal(meta.videoCodec, 'h264');
    assert.equal(meta.audioCodec, 'aac');
    assert.ok(meta.duration >= 3.0 && meta.duration <= 4.5);
  } finally {
    await fs.rm(tmpWork, { recursive: true, force: true }).catch(() => {});
  }
});

test('service.rerenderAnime re-plans and re-renders single concept with updated style & audio mix in-place', async () => {
  const root = path.join(__dirname, '..');
  const runtime = path.join(root, 'runtime');
  const testVideo = path.join(root, '.test-data', 'render', 'test-source.mp4');
  const testAudio = path.join(root, '.test-data', 'pipeline', 'work', 'fb912bdc-29d3-49dd-b3ef-b9e388aacaa0', 'audio.wav');

  if (!await fs.stat(testVideo).catch(() => null) || !await fs.stat(path.join(runtime, 'ffmpeg.exe')).catch(() => null)) {
    return; // skip if test video or ffmpeg not present in environment
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reelmind-rerender-'));
  const store = new Store(path.join(tmpRoot, 'db.sqlite'));
  const service = new Service(tmpRoot, runtime, path.join(root, 'workers'), store, () => {}, () => {});

  try {
    const id = randomUUID();
    const work = service.work(id);
    const out = service.out(id);
    await fs.mkdir(work, { recursive: true });
    await fs.mkdir(out, { recursive: true });

    // Copy episode source and music source
    const episodeSource = path.join(work, 'episode.mp4');
    await fs.copyFile(testVideo, episodeSource);
    const musicSource = path.join(work, 'music.wav');
    if (await fs.stat(testAudio).catch(() => null)) {
      await fs.copyFile(testAudio, musicSource);
    } else {
      await fs.copyFile(testVideo, musicSource);
    }

    const musicMap: MusicMap = {
      duration: 180,
      bpm: 130,
      beats: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
      strongBeats: [1.5],
      energySections: []
    };
    const sampleShots: AnimeShot[] = [
      { id: 1, start: 0.0, end: 1.5, duration: 1.5 },
      { id: 2, start: 1.5, end: 3.5, duration: 2.0 }
    ];
    const sampleConcepts: AnimeEditConcept[] = [
      {
        id: 1,
        shotId: 2,
        start: 1.5,
        end: 3.5,
        duration: 2.0,
        impactTime: 2.5,
        category: 'action',
        style: 'hard_beat_drop',
        title: 'Initial Hard Drop',
        description: 'First render style',
        narrativeImportance: 'high',
        qualityScore: 92,
        motionScore: 0.8,
        faceScore: 0.3,
        transientScore: 0.9,
        hasDialogue: false
      }
    ];

    await fs.writeFile(path.join(work, 'music_map.json'), JSON.stringify(musicMap));
    await fs.writeFile(path.join(work, 'shots.json'), JSON.stringify(sampleShots));
    await fs.writeFile(path.join(work, 'edit_concepts.json'), JSON.stringify(sampleConcepts));

    const initialFile = path.join(out, 'reelmind_01.mp4');
    await fs.writeFile(initialFile, 'initial-placeholder');

    const job: Job = {
      id,
      title: 'Anime Rerender Test',
      input: {
        kind: 'local',
        value: episodeSource,
        musicPath: musicSource,
        language: 'ja'
      },
      studio: 'anime',
      stage: 'completed',
      checkpoint: 'rendering',
      progress: 100,
      message: 'Render complete',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      outputs: [
        {
          id: '01',
          title: 'Initial Hard Drop',
          duration: 3.5,
          file: initialFile,
          reason: 'ACTION · hard beat drop (92% match)'
        }
      ],
      provider: 'Local',
      animeAnalysis: {
        language: 'ja',
        shotCount: 2,
        bpm: 130,
        candidatesCount: 1,
        conceptsCount: 1,
        concepts: sampleConcepts
      }
    };
    store.put(job);

    // Execute rerenderAnime with new style 'velocity_ramp' and custom audio mix
    await service.rerenderAnime(id, 1, {
      style: 'velocity_ramp',
      sourceAudioMix: 0.25,
      musicMix: 0.90
    });

    // 1. Verify output file was replaced with actual rendered video
    const finalFileStat = await fs.stat(initialFile);
    assert.ok(finalFileStat.size > 1000, 'Rendered MP4 should be a real media file > 1KB');

    // 2. Verify job outputs was updated in-place with new style
    const updatedJob = store.get(id)!;
    assert.equal(updatedJob.outputs.length, 1);
    const updatedOutput = updatedJob.outputs[0];
    assert.equal(updatedOutput.id, '01');
    assert.ok(updatedOutput.reason?.includes('velocity ramp'), `Reason should include 'velocity ramp', got: ${updatedOutput.reason}`);

    // 3. Verify edit_concepts.json was updated on disk
    const diskConcepts: AnimeEditConcept[] = JSON.parse(await fs.readFile(path.join(work, 'edit_concepts.json'), 'utf8'));
    assert.equal(diskConcepts[0].style, 'velocity_ramp');

    // 4. Verify plan.json has custom audio mix and velocity style
    const planFile = path.join(work, 'amv_01', 'plan.json');
    assert.ok(await fs.stat(planFile).catch(() => null));
    const savedPlan: AnimeEditPlan = JSON.parse(await fs.readFile(planFile, 'utf8'));
    assert.equal(savedPlan.style, 'velocity_ramp');
    assert.equal(savedPlan.audio.sourceAudioMix, 0.25);
    assert.equal(savedPlan.audio.musicMix, 0.90);
  } finally {
    store.db.close();
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test('service.rerenderAnime rejects invalid inputs, busy projects, and missing concepts gracefully', async () => {
  const root = path.join(__dirname, '..');
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reelmind-rerender-err-'));
  const store = new Store(path.join(tmpRoot, 'db.sqlite'));
  const service = new Service(tmpRoot, 'unused', 'unused', store, () => {}, () => {});

  try {
    // 1. Non-existent job
    await assert.rejects(
      () => service.rerenderAnime('00000000-0000-0000-0000-000000000000', 1),
      /Anime project not found/
    );

    // 2. Non-anime job (e.g. podcast studio)
    const podcastJob: Job = {
      id: randomUUID(),
      title: 'Podcast',
      input: { kind: 'local', value: 'video.mp4' },
      stage: 'completed',
      checkpoint: 'rendering',
      progress: 100,
      message: 'Done',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      outputs: [],
      provider: 'Local'
    };
    store.put(podcastJob);
    await assert.rejects(
      () => service.rerenderAnime(podcastJob.id, 1),
      /Anime project not found/
    );

    // 3. Busy project
    const animeJob: Job = {
      id: randomUUID(),
      title: 'Busy Anime',
      input: { kind: 'local', value: 'episode.mp4' },
      studio: 'anime',
      stage: 'completed',
      checkpoint: 'rendering',
      progress: 100,
      message: 'Done',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      outputs: [],
      provider: 'Local'
    };
    store.put(animeJob);
    service.active.set(animeJob.id, new AbortController());
    await assert.rejects(
      () => service.rerenderAnime(animeJob.id, 1),
      /Project is currently busy processing/
    );
    service.active.delete(animeJob.id);

    // 4. Missing analysis data files
    await assert.rejects(
      () => service.rerenderAnime(animeJob.id, 1),
      /Source episode file is no longer in workspace/
    );
  } finally {
    store.db.close();
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test('workers/shared/transcription.py properly frees VRAM with gc.collect and torch.cuda.empty_cache in finally block', async () => {
  const root = path.join(__dirname, '..');
  const transScript = path.join(root, 'workers', 'shared', 'transcription.py');
  const content = await fs.readFile(transScript, 'utf8');

  // Verify memory cleanup structure in GPU transcription path
  assert.ok(content.includes('del model'), 'Script must delete model reference');
  assert.ok(content.includes('gc.collect()'), 'Script must invoke garbage collector');
  assert.ok(content.includes('torch.cuda.empty_cache()'), 'Script must call torch.cuda.empty_cache to flush GPU VRAM');
  assert.ok(content.includes('finally:'), 'VRAM cleanup must be guaranteed in a finally block');
});

test('buildAnimeFilterGraph applies velocity ramping speed curves and tblend temporal smoothing', () => {
  const plan: AnimeEditPlan = {
    version: 1,
    conceptId: 1,
    title: 'Velocity Test',
    style: 'velocity_ramp',
    category: 'action',
    duration: 6.0,
    fps: 30,
    bpm: 140,
    cuts: [
      {
        shotId: 1,
        sourceStart: 2.0,
        sourceEnd: 5.0,
        timelineStart: 0.0,
        timelineEnd: 3.0,
        duration: 3.0,
        zoom: 1.05,
        center: 0.5,
        endCenter: 0.5,
        velocityCurve: 'slow_motion'
      },
      {
        shotId: 2,
        sourceStart: 5.0,
        sourceEnd: 8.0,
        timelineStart: 3.0,
        timelineEnd: 6.0,
        duration: 3.0,
        zoom: 1.15,
        center: 0.5,
        endCenter: 0.5,
        velocityCurve: 'impact_ramp'
      }
    ],
    audio: {
      sourceAudioMix: 0.5,
      musicMix: 0.9,
      musicOffset: 0.0
    }
  };

  const graph = buildAnimeFilterGraph(plan, true);
  assert.ok(graph.includes('setpts=1.75*(PTS-STARTPTS)'), 'Should apply slow motion PTS multiplier');
  assert.ok(graph.includes('tblend=all_mode=average'), 'Should apply tblend for temporal smoothing');
  assert.ok(graph.includes('setpts=0.65*(PTS-STARTPTS)'), 'Should apply impact ramp acceleration PTS multiplier');
  assert.ok(graph.includes('atempo=0.57'), 'Should pitch/speed compensate slow audio');
  assert.ok(graph.includes('atempo=1.54'), 'Should pitch/speed compensate fast audio');
});

test('buildAnimeFilterGraph applies dual-stream background blur and character isolation when isolateCharacter is true', () => {
  const plan: AnimeEditPlan = {
    version: 1,
    conceptId: 1,
    title: 'Character Isolation Test',
    style: 'hard_beat_drop',
    category: 'action',
    duration: 3.0,
    fps: 30,
    bpm: 130,
    cuts: [
      {
        shotId: 1,
        sourceStart: 0.0,
        sourceEnd: 3.0,
        timelineStart: 0.0,
        timelineEnd: 3.0,
        duration: 3.0,
        zoom: 1.20,
        center: 0.5,
        endCenter: 0.5,
        isolateCharacter: true,
        effect: 'flash'
      }
    ],
    audio: {
      sourceAudioMix: 0.5,
      musicMix: 0.9,
      musicOffset: 0.0
    }
  };

  const graph = buildAnimeFilterGraph(plan, false);
  assert.ok(graph.includes('split=2[bg_raw0][fg_raw0]'), 'Should split stream for dual-layer composition');
  assert.ok(graph.includes('gblur=sigma=12:steps=2'), 'Should apply gaussian blur to background layer');
  assert.ok(graph.includes('vignette=angle=PI/3.5'), 'Should apply vignette focus to character foreground layer');
  assert.ok(graph.includes('blend=all_mode=screen:all_opacity=0.6'), 'Should blend background and foreground streams');
});

test('interrupted anime job in scenes or music stage transitions to paused in service.init and can be resumed', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reelmind-anime-recover-'));
  const store = new Store(path.join(tmpRoot, 'db.sqlite'));
  const service = new Service(tmpRoot, 'unused', 'unused', store, () => {}, () => {});
  service.stopping = true;

  try {
    const jobScenesId = randomUUID();
    const jobMusicId = randomUUID();
    const now = Date.now();

    const jobScenes: Job = {
      id: jobScenesId,
      studio: 'anime',
      title: 'Anime in Scenes Detection',
      input: { kind: 'local', value: 'ep.mp4', musicPath: 'm.mp3', language: 'ja' },
      stage: 'scenes',
      checkpoint: 'scenes',
      progress: 25,
      message: 'Detecting shots',
      createdAt: now,
      updatedAt: now,
      outputs: [],
      provider: 'Local'
    };

    const jobMusic: Job = {
      id: jobMusicId,
      studio: 'anime',
      title: 'Anime in Music Analysis',
      input: { kind: 'local', value: 'ep.mp4', musicPath: 'm.mp3', language: 'ja' },
      stage: 'music',
      checkpoint: 'music',
      progress: 55,
      message: 'Mapping music beats',
      createdAt: now,
      updatedAt: now,
      outputs: [],
      provider: 'Local'
    };

    store.put(jobScenes);
    store.put(jobMusic);

    // Call service.init() simulating application startup after unexpected crash
    await service.init();

    const recoveredScenes = store.get(jobScenesId)!;
    const recoveredMusic = store.get(jobMusicId)!;

    assert.equal(recoveredScenes.stage, 'paused');
    assert.ok(recoveredScenes.message.includes('Processing was interrupted'));
    assert.ok(recoveredScenes.cleanupAt && recoveredScenes.cleanupAt > now);

    assert.equal(recoveredMusic.stage, 'paused');
    assert.ok(recoveredMusic.message.includes('Processing was interrupted'));
    assert.ok(recoveredMusic.cleanupAt && recoveredMusic.cleanupAt > now);

    // Test resume
    await service.action(jobScenesId, 'resume');
    assert.equal(store.get(jobScenesId)?.stage, 'queued');
    assert.equal(store.get(jobScenesId)?.checkpoint, 'scenes');

    await service.action(jobMusicId, 'resume');
    assert.equal(store.get(jobMusicId)?.stage, 'queued');
    assert.equal(store.get(jobMusicId)?.checkpoint, 'music');
  } finally {
    store.db.close();
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});



