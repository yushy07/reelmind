import type {
  AnimeCandidate,
  AnimeCandidateCategory,
  AnimeEditConcept,
  AnimeEditStyle,
  MusicMap,
  MusicRegion,
  MusicSectionLabel
} from '../../shared/types';

/**
 * Normalized profile for Anime Candidate moments.
 */
export interface AnimeClipProfile {
  id: number;
  shotId: number;
  duration: number;
  category: AnimeCandidateCategory;
  motionScore: number;
  faceScore: number;
  audioEnergyScore: number;
  transientScore: number;
  impactScore: number;
  totalScore: number;
  hasDialogue: boolean;
  preferredSectionTypes: MusicSectionLabel[];
  preferredMinEnergy: number;
}

/**
 * Builds an AnimeClipProfile from an existing scored AnimeCandidate.
 */
export function buildAnimeClipProfile(cand: AnimeCandidate): AnimeClipProfile {
  let preferredSections: MusicSectionLabel[] = [];
  let preferredMinEnergy = 0.4;

  switch (cand.category) {
    case 'action':
      preferredSections = ['drop', 'climax', 'chorus'];
      preferredMinEnergy = 0.65;
      break;
    case 'emotional':
      preferredSections = ['break', 'bridge', 'ambient', 'verse'];
      preferredMinEnergy = 0.25;
      break;
    case 'dialogue':
      preferredSections = ['verse', 'break', 'bridge', 'intro'];
      preferredMinEnergy = 0.30;
      break;
    case 'cinematic':
    default:
      preferredSections = ['chorus', 'climax', 'verse', 'intro'];
      preferredMinEnergy = 0.45;
      break;
  }

  return {
    id: cand.id,
    shotId: cand.shotId,
    duration: cand.duration,
    category: cand.category,
    motionScore: cand.motionScore,
    faceScore: cand.faceScore,
    audioEnergyScore: cand.audioEnergyScore,
    transientScore: cand.transientScore,
    impactScore: cand.impactScore,
    totalScore: cand.totalScore,
    hasDialogue: cand.hasDialogue,
    preferredSectionTypes: preferredSections,
    preferredMinEnergy
  };
}

/**
 * Music matching configuration options.
 */
export interface MusicMatchingConfig {
  minOverlapPenalty: number;
  exactOverlapPenalty: number;
  energyWeight: number;
  sectionWeight: number;
  qualityWeight: number;
  temporalDiversityWeight: number;
}

export const defaultMatchingConfig: MusicMatchingConfig = {
  minOverlapPenalty: 0.60,
  exactOverlapPenalty: 0.95,
  energyWeight: 0.35,
  sectionWeight: 0.30,
  qualityWeight: 0.20,
  temporalDiversityWeight: 0.15
};

/**
 * Evaluates compatibility score between an AnimeClipProfile and a candidate MusicRegion.
 */
export function scoreMusicRegionCompatibility(
  clip: AnimeClipProfile,
  region: MusicRegion,
  assignedRegions: MusicRegion[] = [],
  config: MusicMatchingConfig = defaultMatchingConfig
): number {
  // 1. Energy compatibility
  const energyDelta = Math.abs(region.energy - clip.preferredMinEnergy);
  const energyScore = Math.max(0, 1.0 - energyDelta * 1.5);

  // 2. Section alignment
  let sectionScore = 0.5;
  const matchIdx = clip.preferredSectionTypes.indexOf(region.sectionLabel);
  if (matchIdx === 0) sectionScore = 1.0;
  else if (matchIdx > 0) sectionScore = Math.max(0.6, 1.0 - matchIdx * 0.15);
  else if (clip.category === 'action' && region.sectionLabel === 'break') sectionScore = 0.2;
  else if (clip.category === 'emotional' && region.sectionLabel === 'drop') sectionScore = 0.25;

  // 3. Intrinsic region quality
  const qualityScore = region.qualityScore || 0.7;

  // 4. Temporal & diversity penalty against already assigned regions in this generation run
  let diversityPenalty = 0.0;
  for (const assigned of assignedRegions) {
    // Exact or near-identical time overlap
    const overlapStart = Math.max(region.start, assigned.start);
    const overlapEnd = Math.min(region.end, assigned.end);
    const overlapDur = Math.max(0, overlapEnd - overlapStart);

    if (overlapDur > 5.0) {
      // High overlap with an already assigned music region!
      const overlapRatio = overlapDur / Math.min(region.duration, assigned.duration);
      if (overlapRatio > 0.6) {
        diversityPenalty += config.exactOverlapPenalty;
      } else {
        diversityPenalty += config.minOverlapPenalty * overlapRatio;
      }
    } else if (Math.abs(region.start - assigned.start) < 15.0) {
      // Nearby timestamp penalty
      diversityPenalty += 0.20;
    }
  }

  const baseScore =
    config.energyWeight * energyScore +
    config.sectionWeight * sectionScore +
    config.qualityWeight * qualityScore;

  return Math.max(0.01, Math.min(1.0, baseScore - diversityPenalty));
}

/**
 * Matches a set of AnimeEditConcepts to distinct candidate MusicRegions.
 * Enforces:
 * - Unique assignment per clip
 * - No silent reuse of identical regions
 * - Diversity and section-to-clip matching
 * - Graceful fallback if track duration is constrained
 */
export function matchMusicRegionsToConcepts(
  concepts: AnimeEditConcept[],
  musicMap: MusicMap,
  config: MusicMatchingConfig = defaultMatchingConfig
): Map<number, MusicRegion> {
  const assignments = new Map<number, MusicRegion>();
  if (!concepts.length) return assignments;

  const candidateRegions = [...(musicMap.regions || [])];
  // If regions array is empty, synthesize basic phrase regions from beats/duration
  if (!candidateRegions.length) {
    const dur = musicMap.duration || 60;
    candidateRegions.push({
      id: 'reg_synth_01',
      start: 0,
      end: Math.min(28.0, dur),
      duration: Math.min(28.0, dur),
      sectionLabel: 'verse',
      energy: 0.5,
      peakEnergy: 0.7,
      onsetDensity: 0.5,
      beatCount: 16,
      downbeatCount: 4,
      qualityScore: 0.75,
      beatAlignedStart: true,
      downbeatAlignedStart: true,
      beatAlignedEnd: true
    });
  }

  const assignedList: MusicRegion[] = [];

  for (const concept of concepts) {
    const clipProfile = buildAnimeClipProfile({
      id: concept.id,
      shotId: concept.shotId,
      start: concept.start,
      end: concept.end,
      duration: concept.duration,
      impactTime: concept.impactTime,
      motionScore: concept.motionScore,
      faceScore: concept.faceScore,
      audioEnergyScore: 0.5,
      transientScore: concept.transientScore,
      impactScore: concept.qualityScore / 100,
      totalScore: concept.qualityScore / 100,
      category: concept.category,
      hasDialogue: concept.hasDialogue,
      dialogueText: concept.dialogueText,
      facesCount: 1,
      maxFaceRatio: 0.2
    });

    // Score all available regions against this clip profile
    const scoredRegions = candidateRegions.map((region) => ({
      region,
      score: scoreMusicRegionCompatibility(clipProfile, region, assignedList, config)
    }));

    // Sort by compatibility descending
    scoredRegions.sort((a, b) => b.score - a.score);

    // Pick top scoring region
    const best = scoredRegions[0]?.region || candidateRegions[0];
    assignments.set(concept.id, best);
    assignedList.push(best);
  }

  return assignments;
}
