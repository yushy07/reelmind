import type {
  AnimeCandidate,
  AnimeEditConcept,
  AnimeShot,
  MusicMap,
  AnimeEditPlan,
  AnimeShotCut,
  AnimeEditStyle
} from '../../shared/types';

function assTime(n: number): string {
  const h = Math.floor(n / 3600);
  const m = Math.floor(n / 60) % 60;
  const s = Math.floor(n) % 60;
  const c = Math.floor(n * 100) % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function escapeAss(s: string): string {
  return s.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ');
}

/**
 * Creates styled ASS captions for anime dialogue moments.
 */
export function makeAnimeCaptions(
  dialogueText: string,
  start: number,
  end: number,
  aspectRatio: '9:16' | '16:9' | '1:1' = '9:16'
): string {
  const isCinema = aspectRatio === '16:9';
  const isSquare = aspectRatio === '1:1';
  const resX = isCinema ? 1920 : 1080;
  const resY = isCinema ? 1080 : (isSquare ? 1080 : 1920);
  const marginV = isCinema ? 140 : (isSquare ? 160 : 520);
  const fontSize = isCinema ? 54 : (isSquare ? 52 : 72);

  const isJapanese = /[\u3040-\u30ff\u3400-\u9fff]/.test(dialogueText);
  const fontName = isJapanese ? 'Noto Sans CJK JP' : 'Noto Sans';

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${resX}
PlayResY: ${resY}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00121110,&H80000000,-1,0,0,0,100,100,0,0,1,5.0,2.0,2,80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const clean = escapeAss(dialogueText.trim());
  const event = `Dialogue: 0,${assTime(start)},${assTime(Math.max(start + 0.3, end))},Default,,0,0,0,,{\\fad(100,100)\\t(0,80,\\fscx106\\fscy106)}${clean}\n`;
  return header + event;
}

/**
 * Finds or synthesizes beat timestamps from the music map.
 */
function getMusicBeats(musicMap: MusicMap, startSec: number, duration: number): number[] {
  const bpm = musicMap.bpm || 130;
  const beatInterval = 60.0 / bpm;
  const endSec = startSec + duration;

  const inRange = (musicMap.beats || []).filter(b => b >= startSec - 0.05 && b <= endSec + 0.05);
  if (inRange.length >= 4) {
    return inRange;
  }

  // Synthesize rhythmic beats using BPM if beat array is sparse
  const syn: number[] = [];
  let curr = startSec;
  while (curr <= endSec) {
    syn.push(Math.round(curr * 1000) / 1000);
    curr += beatInterval;
  }
  return syn;
}

/**
 * Plans an AMV edit for a single discovered AnimeEditConcept.
 * Aligns the primary impact frame T_impact to a musical beat drop,
 * structures build -> impact -> payoff shot sequences, and
 * generates smart vertical/square/cinematic reframe coordinates and camera dynamics.
 */
export function planAnimeEdit(
  concept: AnimeEditConcept,
  musicMap: MusicMap,
  allShots: AnimeShot[] = [],
  fps: 30 = 30,
  aspectRatio: '9:16' | '16:9' | '1:1' = '9:16'
): AnimeEditPlan {
  const bpm = musicMap.bpm || 135;
  const beatDuration = 60.0 / bpm;

  // Stagger music starting section across concepts (e.g. 15s per concept)
  // so each of the 3-5 rendered AMVs has a distinct musical portion
  const musicDuration = musicMap.duration || 180;
  const slotIndex = Math.max(0, (concept.id - 1) % 5);
  // Enforce minimum 25-second duration when sufficient footage is available
  const totalAvailableShotsDuration = allShots.reduce((acc, s) => acc + s.duration, 0);
  const slotDuration = totalAvailableShotsDuration >= 25.0 ? 28.0 : Math.max(12.0, Math.min(25.0, totalAvailableShotsDuration || 18.0));
  let musicOffset = Math.min(musicDuration - slotDuration - 2.0, slotIndex * 22.0 + 8.0);
  if (musicOffset < 0) musicOffset = 0;

  // Find a strong beat or climax drop in this musical segment
  const beats = getMusicBeats(musicMap, musicOffset, slotDuration);
  const strongBeats = (musicMap.strongBeats || []).filter(b => b >= musicOffset + 3.0 && b <= musicOffset + slotDuration - 3.0);
  
  // The drop beat in the music: preferred strong beat or ~35-45% into the clip
  let dropMusicBeat = strongBeats.length > 0 ? strongBeats[0] : (beats[Math.floor(beats.length * 0.4)] || musicOffset + 6.0);
  const timelineDropTime = Math.max(3.0, Math.round((dropMusicBeat - musicOffset) * 1000) / 1000);

  // We want the concept's impact moment (concept.impactTime) to hit exactly at timelineDropTime
  const impactSourceTime = concept.impactTime;

  // Horizontal framing center based on character / face detection
  // 0.5 is centered. Clamped to [0.25, 0.75] so vertical crop doesn't bleed out of frame.
  const faceBonus = concept.faceScore > 0.3 ? (concept.shotId % 2 === 0 ? 0.08 : -0.08) : 0;
  const baseCenter = Math.max(0.28, Math.min(0.72, Math.round((0.5 + faceBonus) * 100) / 100));

  // Determine neighboring contextual shots to build an authentic sequence
  // If no neighboring shots exist, slice the concept's shot into build, impact, and payoff
  const shotIdx = allShots.findIndex(s => s.id === concept.shotId);
  const prevShot = shotIdx > 0 ? allShots[shotIdx - 1] : undefined;

  const cuts: AnimeShotCut[] = [];
  let currentTimeline = 0.0;

  // 1. Build Phase (leading up to drop): 2 cuts or 1 cut leading into impact
  const buildDuration = timelineDropTime;
  if (prevShot && prevShot.duration >= 1.5 && buildDuration >= 4.0) {
    const cut1Dur = Math.round((buildDuration * 0.45) * 1000) / 1000;
    const cut2Dur = Math.round((buildDuration - cut1Dur) * 1000) / 1000;

    // Intro establishing shot
    cuts.push({
      shotId: prevShot.id,
      sourceStart: Math.max(prevShot.start, prevShot.end - cut1Dur),
      sourceEnd: prevShot.end,
      timelineStart: currentTimeline,
      timelineEnd: currentTimeline + cut1Dur,
      duration: cut1Dur,
      zoom: 1.04,
      center: baseCenter,
      endCenter: baseCenter,
      effect: concept.style === 'velocity_ramp' ? 'velocity_ramp' : undefined
    });
    currentTimeline += cut1Dur;

    // Build shot (pre-impact anticipation)
    const leadInStart = Math.max(concept.start, impactSourceTime - cut2Dur);
    cuts.push({
      shotId: concept.shotId,
      sourceStart: leadInStart,
      sourceEnd: impactSourceTime,
      timelineStart: currentTimeline,
      timelineEnd: currentTimeline + cut2Dur,
      duration: cut2Dur,
      zoom: 1.10,
      center: baseCenter,
      endCenter: baseCenter + 0.04,
      effect: concept.style === 'hard_beat_drop' ? 'punch' : (concept.style === 'velocity_ramp' ? 'velocity_ramp' : undefined),
      velocityCurve: concept.style === 'velocity_ramp' ? 'slow_motion' : (concept.style === 'slow_burn' ? 'ease_in_out' : 'linear')
    });
    currentTimeline += cut2Dur;
  } else {
    // Single build shot directly inside concept
    const leadInStart = Math.max(concept.start, impactSourceTime - buildDuration);
    const actualBuildDur = impactSourceTime - leadInStart;
    cuts.push({
      shotId: concept.shotId,
      sourceStart: leadInStart,
      sourceEnd: impactSourceTime,
      timelineStart: 0.0,
      timelineEnd: actualBuildDur,
      duration: actualBuildDur,
      zoom: 1.08,
      center: baseCenter,
      endCenter: baseCenter + 0.03,
      effect: concept.style === 'hard_beat_drop' ? 'punch' : (concept.style === 'velocity_ramp' ? 'velocity_ramp' : undefined),
      velocityCurve: concept.style === 'velocity_ramp' ? 'slow_motion' : (concept.style === 'slow_burn' ? 'ease_in_out' : 'linear')
    });
    currentTimeline = actualBuildDur;
  }

  // 2. Climax / Impact Cut (the decisive moment)
  // Lasts 4-6 beats (e.g. 2.0s - 3.5s)
  const impactCutDur = Math.min(3.5, Math.max(1.8, Math.round(beatDuration * 4 * 100) / 100));
  const impactCutEnd = Math.min(concept.end, impactSourceTime + impactCutDur);
  const actualImpactDur = Math.max(1.2, impactCutEnd - impactSourceTime);

  cuts.push({
    shotId: concept.shotId,
    sourceStart: impactSourceTime,
    sourceEnd: impactCutEnd,
    timelineStart: currentTimeline,
    timelineEnd: currentTimeline + actualImpactDur,
    duration: actualImpactDur,
    impactOffset: 0.0, // starts right on the drop
    zoom: concept.style === 'hard_beat_drop' ? 1.22 : 1.15,
    center: baseCenter + 0.02,
    endCenter: baseCenter,
    effect: concept.style === 'hard_beat_drop' ? 'flash' : (concept.style === 'velocity_ramp' ? 'velocity_ramp' : 'shake'),
    velocityCurve: concept.style === 'velocity_ramp' ? 'impact_ramp' : (concept.style === 'slow_burn' ? 'ease_in_out' : 'linear'),
    isolateCharacter: concept.style === 'velocity_ramp' || concept.style === 'hard_beat_drop' || concept.style === 'dialogue_pause'
  });
  currentTimeline += actualImpactDur;

  // 3. Payoff / Resolution Phase (aftermath of the hit)
  // Sequence subsequent shots to build a full, coherent payoff segment
  let nextIdx = shotIdx >= 0 ? shotIdx + 1 : -1;
  while (currentTimeline < slotDuration - 0.5 && nextIdx >= 0 && nextIdx < allShots.length) {
    const s = allShots[nextIdx];
    const remainingTarget = slotDuration - currentTimeline;
    const payoffDur = Math.min(remainingTarget, s.duration);
    if (payoffDur >= 0.8) {
      cuts.push({
        shotId: s.id,
        sourceStart: s.start,
        sourceEnd: s.start + payoffDur,
        timelineStart: currentTimeline,
        timelineEnd: currentTimeline + payoffDur,
        duration: payoffDur,
        zoom: 1.06,
        center: baseCenter,
        endCenter: baseCenter,
        effect: concept.style === 'slow_burn' ? 'glow' : undefined
      });
      currentTimeline += payoffDur;
    }
    nextIdx++;
  }

  // If still needing duration to reach slotDuration, expand from concept aftermath or earlier shots
  if (currentTimeline < slotDuration - 0.5) {
    const remainingTarget = slotDuration - currentTimeline;
    const extStart = Math.min(concept.end, impactCutEnd);
    const availableInConcept = Math.max(0, concept.end - extStart);
    if (availableInConcept >= 0.8) {
      const extDur = Math.min(remainingTarget, availableInConcept);
      cuts.push({
        shotId: concept.shotId,
        sourceStart: extStart,
        sourceEnd: extStart + extDur,
        timelineStart: currentTimeline,
        timelineEnd: currentTimeline + extDur,
        duration: extDur,
        zoom: 1.05,
        center: baseCenter,
        endCenter: baseCenter
      });
      currentTimeline += extDur;
    }
  }

  // Audio balance based on style & dialogue
  let sourceAudioMix = 0.55;
  let musicMix = 0.85;
  if (concept.style === 'dialogue_pause' || concept.hasDialogue) {
    sourceAudioMix = 0.75;
    musicMix = 0.65;
  } else if (concept.style === 'hard_beat_drop') {
    sourceAudioMix = 0.45;
    musicMix = 0.95;
  }

  // Subtitle generation for dialogue moments
  let captions: string | undefined;
  if (concept.hasDialogue && concept.dialogueText) {
    const dialogueCut = cuts.find((c) => c.shotId === concept.shotId) || cuts[0];
    if (dialogueCut) {
      const cStart = dialogueCut.timelineStart;
      const cEnd = Math.min(dialogueCut.timelineEnd, cStart + 4.0);
      captions = makeAnimeCaptions(concept.dialogueText, cStart, cEnd, aspectRatio);
    }
  }

  return {
    version: 1,
    conceptId: concept.id,
    title: concept.title || `AMV Cut · ${concept.category.toUpperCase()}`,
    style: concept.style,
    category: concept.category,
    duration: Math.round(currentTimeline * 100) / 100,
    fps,
    bpm,
    aspectRatio,
    captions,
    cuts,
    audio: {
      sourceAudioMix,
      musicMix,
      musicOffset: Math.round(musicOffset * 100) / 100
    }
  };
}
