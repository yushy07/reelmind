import { z } from 'zod';
import type { AnimeCandidate, AnimeEditConcept, AnimeEditStyle, AnimeCandidateCategory, MusicMap, Settings, Provider } from '../../shared/types';

export const animeEvaluationItemSchema = z.object({
  candidateId: z.number(),
  qualityScore: z.number().min(0).max(100),
  sceneVibe: z.enum(['high_energy_action', 'emotional_drama', 'iconic_dialogue', 'cinematic_atmosphere']).catch('high_energy_action'),
  narrativeImportance: z.enum(['high', 'medium', 'low']).catch('medium'),
  recommendedInOffset: z.number().min(-5).max(5).default(0),
  recommendedOutOffset: z.number().min(-5).max(5).default(0),
  editStyle: z.enum(['hard_beat_drop', 'slow_burn', 'dialogue_pause', 'velocity_ramp']).catch('hard_beat_drop'),
  title: z.string().max(80).optional(),
  description: z.string().max(200).optional()
});

export const animeEvaluationResponseSchema = z.object({
  evaluations: z.array(animeEvaluationItemSchema)
});

export type AnimeEvaluationItem = z.infer<typeof animeEvaluationItemSchema>;

export function buildGeminiEvaluationPrompt(candidates: AnimeCandidate[], musicMap: MusicMap): string {
  const compact = candidates.slice(0, 24).map(c => ({
    id: c.id,
    shotId: c.shotId,
    start: c.start,
    end: c.end,
    duration: c.duration,
    impactTime: c.impactTime,
    motionScore: c.motionScore,
    faceScore: c.faceScore,
    transientScore: c.transientScore,
    category: c.category,
    dialogue: c.dialogueText || undefined
  }));

  return `You are an expert anime video editor and AMV director.
Evaluate these local candidate moments for high-quality vertical 9:16 AMVs.
Music Track BPM: ${musicMap.bpm}.
Evaluate narrative impact, visual dynamism, and edit compatibility.
Return JSON only:
{"evaluations":[{"candidateId":number,"qualityScore":number,"sceneVibe":"high_energy_action"|"emotional_drama"|"iconic_dialogue"|"cinematic_atmosphere","narrativeImportance":"high"|"medium"|"low","recommendedInOffset":number,"recommendedOutOffset":number,"editStyle":"hard_beat_drop"|"slow_burn"|"dialogue_pause"|"velocity_ramp","title":string,"description":string}]}
Candidates:
${JSON.stringify(compact)}`;
}

export function selectDiverseConcepts(
  candidates: AnimeCandidate[],
  evaluationsMap: Map<number, AnimeEvaluationItem> = new Map()
): AnimeEditConcept[] {
  if (!candidates.length) return [];

  // Sort candidates by combined score (evaluations + local score)
  const scored = candidates.map(c => {
    const ev = evaluationsMap.get(c.id);
    const qualityNorm = ev ? ev.qualityScore / 100 : c.totalScore;
    const combinedScore = Math.round(((c.totalScore * 0.45) + (qualityNorm * 0.55)) * 1000) / 1000;
    return { candidate: c, evaluation: ev, combinedScore };
  });

  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  const categories: AnimeCandidateCategory[] = ['action', 'emotional', 'dialogue', 'cinematic'];
  const selected: { candidate: AnimeCandidate; evaluation?: AnimeEvaluationItem; combinedScore: number }[] = [];

  function isOverlapping(cand: AnimeCandidate): boolean {
    return selected.some(s => Math.abs(s.candidate.start - cand.start) < 2.5 || (cand.start < s.candidate.end && cand.end > s.candidate.start));
  }

  // Pick top non-overlapping candidate from each primary category
  for (const cat of categories) {
    const match = scored.find(item => item.candidate.category === cat && !isOverlapping(item.candidate));
    if (match) {
      selected.push(match);
    }
  }

  // Fill up to 4 or 5 total concepts using highest remaining non-overlapping candidates
  for (const item of scored) {
    if (selected.length >= 5) break;
    if (!selected.some(s => s.candidate.id === item.candidate.id) && !isOverlapping(item.candidate)) {
      selected.push(item);
    }
  }

  // If still fewer than 3, add highest available without strict collision check
  if (selected.length < 3) {
    for (const item of scored) {
      if (selected.length >= Math.min(3, scored.length)) break;
      if (!selected.some(s => s.candidate.id === item.candidate.id)) {
        selected.push(item);
      }
    }
  }

  // Format final AnimeEditConcept objects
  return selected.map((item, idx) => {
    const c = item.candidate;
    const ev = item.evaluation;

    let style: AnimeEditStyle;
    if (ev?.editStyle) {
      style = ev.editStyle;
    } else {
      style = c.category === 'action' ? 'hard_beat_drop'
            : c.category === 'emotional' ? 'slow_burn'
            : c.category === 'dialogue' ? 'dialogue_pause'
            : 'velocity_ramp';
    }

    const defaultTitle = `${c.category.toUpperCase()} · ${c.duration}s Cut`;
    const defaultDesc = c.hasDialogue && c.dialogueText
      ? `Moment featuring: "${c.dialogueText.slice(0, 60)}..."`
      : `High-impact moment with hit at ${c.impactTime}s`;

    return {
      id: idx + 1,
      shotId: c.shotId,
      start: c.start,
      end: c.end,
      duration: c.duration,
      impactTime: c.impactTime,
      category: c.category,
      style,
      title: ev?.title || defaultTitle,
      description: ev?.description || defaultDesc,
      narrativeImportance: ev?.narrativeImportance || (c.totalScore > 0.65 ? 'high' : 'medium'),
      qualityScore: ev ? ev.qualityScore : Math.round(c.totalScore * 100),
      motionScore: c.motionScore,
      faceScore: c.faceScore,
      transientScore: c.transientScore,
      hasDialogue: c.hasDialogue,
      dialogueText: c.dialogueText
    };
  });
}

export async function selectAnimeMoments(
  candidates: AnimeCandidate[],
  musicMap: MusicMap,
  settings: Settings,
  getKey: (p: Provider) => Promise<string>,
  signal: AbortSignal,
  report: (msg: string) => void,
  request: typeof fetch = fetch
): Promise<AnimeEditConcept[]> {
  if (!candidates.length) return [];

  const evaluationsMap = new Map<number, AnimeEvaluationItem>();

  // Attempt Gemini Free Tier batched evaluation if enabled
  if (settings.cloudEnabled && settings.geminiFreeConfirmed) {
    let key = '';
    try {
      key = await getKey('gemini');
    } catch {
      report('Fallback · Gemini credentials unavailable; using local diversity ranking');
    }

    if (key) {
      try {
        report('Gemini · evaluating candidate moments and narrative vibe');
        const prompt = buildGeminiEvaluationPrompt(candidates, musicMap);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent`;

        const res = await request(url, {
          method: 'POST',
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2
            }
          })
        });

        if (res.ok) {
          const data = await res.json();
          const raw = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('');
          if (raw) {
            const parsed = animeEvaluationResponseSchema.parse(JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '')));
            for (const item of parsed.evaluations) {
              evaluationsMap.set(item.candidateId, item);
            }
            report(`Gemini · evaluated ${parsed.evaluations.length} candidate moments successfully`);
          }
        } else {
          report(`Fallback · Gemini ${res.status === 429 ? 'free quota reached' : 'service unavailable'}; using local ranking`);
        }
      } catch (error) {
        signal.throwIfAborted();
        report('Fallback · Gemini evaluation timeout or error; using local ranking');
      }
    }
  } else if (!settings.cloudEnabled) {
    report('Local analysis · cloud disabled; selecting moments via local ranking');
  }

  // Diversity selection to produce 3-5 distinct edit concepts
  report('Selecting 3–5 diverse edit concepts across core vibes');
  return selectDiverseConcepts(candidates, evaluationsMap);
}
