import type { Candidate, Transcript } from '../shared/types';

export const SEMANTIC_VERSION='minilm-e8f8c211-window128-mean-v1';
export function candidateTexts(candidates:Candidate[],transcript:Transcript):string[]{
  const words=transcript.segments.flatMap(s=>s.words);
  return candidates.map(c=>words.filter(w=>w.end>c.start&&w.start<c.end).map(w=>w.text).join(' ').trim());
}
export function semanticSelection(candidates:Candidate[],vectors:number[][],threshold=.88):Candidate[]{
  if(vectors.length!==candidates.length)throw new Error('Embedding count mismatch');
  const normalized=vectors.map(vector=>{
    if(vector.length!==384||!vector.every(Number.isFinite))throw new Error('Invalid embedding');
    const norm=Math.hypot(...vector);if(norm<1e-8)throw new Error('Empty embedding');
    return vector.map(n=>n/norm);
  });
  const chosen:number[]=[];
  for(const i of candidates.map((_,i)=>i).sort((a,b)=>candidates[b].score-candidates[a].score)){
    if(chosen.some(j=>normalized[i].reduce((sum,n,k)=>sum+n*normalized[j][k],0)>=threshold))continue;
    chosen.push(i);if(chosen.length===12)break;
  }
  return chosen.map(i=>candidates[i]);
}
