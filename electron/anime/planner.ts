import type {
  AnimeCandidate,
  AnimeEditConcept,
  AnimeShot,
  MusicMap,
  AnimeEditPlan,
  AnimeShotCut,
  AnimeEditStyle
} from '../../shared/types';

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
 * generates smart 9:16 vertical reframe coordinates and camera dynamics.
 */
export function planAnimeEdit(
  concept: AnimeEditConcept,
  musicMap: MusicMap,
  allShots: AnimeShot[] = [],
  fps: 30 = 30
): AnimeEditPlan {
  const bpm = musicMap.bpm || 135;
  const beatDuration = 60.0 / bpm;

  // Stagger music starting section across concepts (e.g. 15s per concept)
  // so each of the 3-5 rendered AMVs has a distinct musical portion
  const musicDuration = musicMap.duration || 180;
  const slotIndex = Math.max(0, (concept.id - 1) % 5);
  const slotDuration = 18.0; // 18-second AMV clip
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
  const nextShot = shotIdx >= 0 && shotIdx < allShots.length - 1 ? allShots[shotIdx + 1] : undefined;

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
      effect: concept.style === 'hard_beat_drop' ? 'punch' : undefined
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
      effect: concept.style === 'hard_beat_drop' ? 'punch' : undefined
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
    effect: concept.style === 'hard_beat_drop' ? 'flash' : (concept.style === 'velocity_ramp' ? 'velocity_ramp' : 'shake')
  });
  currentTimeline += actualImpactDur;

  // 3. Payoff / Resolution Phase (aftermath of the hit)
  const remainingTarget = slotDuration - currentTimeline;
  if (remainingTarget > 1.5) {
    if (nextShot && nextShot.duration >= 1.5) {
      const payoffDur = Math.min(remainingTarget, nextShot.duration);
      cuts.push({
        shotId: nextShot.id,
        sourceStart: nextShot.start,
        sourceEnd: nextShot.start + payoffDur,
        timelineStart: currentTimeline,
        timelineEnd: currentTimeline + payoffDur,
        duration: payoffDur,
        zoom: 1.06,
        center: baseCenter,
        endCenter: baseCenter,
        effect: concept.style === 'slow_burn' ? 'glow' : undefined
      });
      currentTimeline += payoffDur;
    } else {
      // Continue from concept aftermath or loop slightly
      const extStart = Math.min(concept.end, impactCutEnd);
      const extEnd = Math.min(concept.end + remainingTarget, concept.start + concept.duration);
      const extDur = Math.max(1.0, extEnd - extStart);
      cuts.push({
        shotId: concept.shotId,
        sourceStart: extStart,
        sourceEnd: extEnd,
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

  return {
    version: 1,
    conceptId: concept.id,
    title: concept.title || `AMV Cut · ${concept.category.toUpperCase()}`,
    style: concept.style,
    category: concept.category,
    duration: Math.round(currentTimeline * 100) / 100,
    fps,
    bpm,
    cuts,
    audio: {
      sourceAudioMix,
      musicMix,
      musicOffset: Math.round(musicOffset * 100) / 100
    }
  };
}
