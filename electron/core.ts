import { z } from 'zod';
import type { Candidate, Transcript, Word, EditPlan, Frame } from '../shared/types';
export const DAY = 24 * 60 * 60 * 1000;
export const candidateSchema = z.object({start:z.number().finite().nonnegative(),end:z.number().finite().positive(),hook:z.string().max(500),context:z.string().max(1000),payoff:z.string().max(1000),category:z.string().max(80),reason:z.string().max(1000),score:z.number().min(0).max(100)}).strict();
export const responseSchema = z.object({candidates:z.array(candidateSchema).max(100)}).strict();
export const settingsSchema = z.object({providerOrder:z.array(z.enum(['gemini','openrouter'])).length(2).refine(a=>new Set(a).size===2),geminiModel:z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),openrouterModel:z.string().max(150).refine(s=>s==='openrouter/free'||/^[\w.-]+\/[\w.:-]+:free$/.test(s),'Only free OpenRouter models are allowed.'),quality:z.enum(['balanced','high']),cloudEnabled:z.boolean(),geminiFreeConfirmed:z.boolean(),transcriptionMode:z.enum(['standard','turbo']).default('standard')}).strict();
export function validateUrl(value:string) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port) throw new Error('Use a public HTTPS video link.');
  const host=url.hostname.toLowerCase();
  if(host==='localhost'||host.endsWith('.local')||/^[\d.]+$/.test(host)||host.includes(':')) throw new Error('Use a public video link.');
  if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host)&&! /\.(mp4|mov|mkv|avi|webm)$/i.test(url.pathname)) throw new Error('V1 accepts YouTube links and direct MP4, MOV, MKV, AVI or WebM links.');
  if(url.searchParams.has('list')&&!url.searchParams.has('v')) throw new Error('Import one video, not a playlist.');
  return url.toString();
}
const terms=(s:string)=>new Set(s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]);
export function similarity(a:string,b:string) {const x=terms(a),y=terms(b);return [...x].filter(t=>y.has(t)).length/Math.max(1,new Set([...x,...y]).size);}
export function expandCandidateContext(candidate: Candidate, t: Transcript): Candidate | null {
  const words = t.segments.flatMap((s) => s.words);
  if (!words.length) return null;

  const rawDur = candidate.end - candidate.start;
  if (rawDur > 75.0) return null;

  const isSentenceEnd = (idx: number) => {
    if (idx < 0 || idx >= words.length) return false;
    const w = words[idx];
    if (/[.!?।。！？]$/.test(w.text.trim())) return true;
    for (const s of t.segments) {
      if (s.words.length && s.words[s.words.length - 1] === w) {
        if (/[.!?।。！？]$/.test(s.text.trim())) return true;
      }
    }
    return false;
  };

  const isSentenceStart = (idx: number) => {
    if (idx <= 0) return true;
    if (isSentenceEnd(idx - 1)) return true;
    const curr = words[idx];
    const prev = words[idx - 1];
    if (curr.start - prev.end > 0.4) return true;
    return false;
  };

  let startIdx = words.findIndex((w) => w.end > candidate.start);
  if (startIdx === -1) startIdx = 0;

  let endIdx = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i].start < candidate.end) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) endIdx = words.length - 1;
  if (startIdx > endIdx) {
    const tmp = startIdx;
    startIdx = endIdx;
    endIdx = tmp;
  }

  // If candidate is already >= 25s, snap gently (within ±3s) to clean sentence boundaries
  if (rawDur >= 25.0 && rawDur <= 70.0) {
    let s = startIdx;
    while (s > 0 && candidate.start - words[s].start < 3.0 && !isSentenceStart(s)) {
      s--;
    }
    if (isSentenceStart(s)) startIdx = s;

    let e = endIdx;
    while (e < words.length - 1 && words[e].end - candidate.end < 3.0 && !isSentenceEnd(e)) {
      e++;
    }
    if (isSentenceEnd(e) && words[e].end - words[startIdx].start <= 70.0) endIdx = e;
  } else {
    // Candidate is < 25s: Expand outward to build a complete short-form story (Hook -> Context -> Payoff)
    let s = startIdx;
    while (s > 0 && candidate.start - words[s].start < 15.0 && !isSentenceStart(s)) {
      s--;
    }
    if (isSentenceStart(s)) startIdx = s;

    let e = endIdx;
    while (e < words.length - 1 && words[e].end - candidate.end < 15.0 && !isSentenceEnd(e)) {
      e++;
    }
    if (isSentenceEnd(e)) endIdx = e;

    while (words[endIdx].end - words[startIdx].start < 25.0) {
      const canBack = startIdx > 0;
      const canFwd = endIdx < words.length - 1;
      if (!canBack && !canFwd) break;

      const durSoFar = words[endIdx].end - words[startIdx].start;
      if (durSoFar >= 65.0) break;

      const backSpan = candidate.start - words[startIdx].start;
      if (canBack && (backSpan < 18.0 || !canFwd)) {
        startIdx--;
        while (startIdx > 0 && !isSentenceStart(startIdx) && candidate.start - words[startIdx].start < 25.0) {
          startIdx--;
        }
      } else if (canFwd) {
        endIdx++;
        while (endIdx < words.length - 1 && !isSentenceEnd(endIdx) && words[endIdx].end - candidate.end < 50.0) {
          endIdx++;
        }
      }
    }
  }

  // Ensure duration <= 65.0s unless strong continuous segment requires it
  while (words[endIdx].end - words[startIdx].start > 65.0 && endIdx > startIdx + 5) {
    let testEnd = endIdx - 1;
    while (testEnd > startIdx && !isSentenceEnd(testEnd)) {
      testEnd--;
    }
    if (testEnd > startIdx && words[testEnd].end - words[startIdx].start >= 25.0) {
      endIdx = testEnd;
    } else {
      endIdx--;
    }
  }

  const wordSpan = words[endIdx].end - words[startIdx].start;
  if (wordSpan < 24.8 || wordSpan > 75.0) {
    return null;
  }

  const maxTotalPad = Math.max(0, 65.0 - wordSpan);
  const startPad = Math.min(0.06, words[startIdx].start, maxTotalPad);
  const paddedStart = Math.max(0, words[startIdx].start - startPad);
  const remainingEndPad = Math.max(0, 65.0 - (words[endIdx].end - paddedStart));
  const endPad = Math.min(0.12, remainingEndPad);
  const paddedEnd = Math.min(t.duration, words[endIdx].end + endPad);

  const finalDur = paddedEnd - paddedStart;
  if (finalDur < 25.0 || finalDur > 75.0) {
    return null;
  }

  const expandedWords = words.slice(startIdx, endIdx + 1);
  const fullText = expandedWords.map((w) => w.text.trim()).join(' ');
  const sentences = fullText.split(/(?<=[.!?।。！？])\s+/).filter(Boolean);

  const hook = sentences[0] || candidate.hook;
  const payoff = sentences.length > 1 ? sentences[sentences.length - 1] : candidate.payoff;
  const context = sentences.length > 2 ? sentences.slice(1, -1).join(' ').slice(0, 950) : (sentences[1] || candidate.context);

  return {
    ...candidate,
    start: paddedStart,
    end: paddedEnd,
    hook: hook.slice(0, 500),
    context: context.slice(0, 1000),
    payoff: payoff.slice(0, 1000),
    score: Math.max(candidate.score, 60),
  };
}

export function selectCandidates(candidates:Candidate[],t:Transcript,options:{limit?:number;lexical?:boolean}={}):Candidate[] {
  const selected:Candidate[]=[];
  for(const raw of [...candidates].sort((a,b)=>b.score-a.score)) {
    if(!candidateSchema.safeParse(raw).success||raw.score<50) continue;
    if(raw.end-raw.start>75) continue;
    const expanded = expandCandidateContext(raw, t);
    if(!expanded) continue;
    const c = expanded;
    if(c.end-c.start<25.0||c.end-c.start>75.0) continue;
    if(selected.some(p=>Math.max(0,Math.min(c.end,p.end)-Math.max(c.start,p.start))/Math.min(c.end-c.start,p.end-p.start)>.3||(options.lexical!==false&&similarity(c.hook+' '+c.context,p.hook+' '+p.context)>.6))) continue;
    selected.push(c);
    if(selected.length===(options.limit??6)) break;
  }
  return selected;
}

export function localCandidates(t:Transcript,options:{limit?:number;lexical?:boolean}={}):Candidate[] {
  const candidates:Candidate[]=[];
  for(let i=0;i<t.segments.length;i++) {
    const first=t.segments[i]; const group=[];
    for(let j=i;j<t.segments.length;j++){
      if(t.segments[j].end-first.start>60.5)break;
      group.push(t.segments[j]);
    }
    if(!group.length)continue;
    const last=group.at(-1)!;
    if(last.end-first.start<25)continue;
    const text=group.map(s=>s.text).join(' '),length=group.reduce((n,s)=>n+s.words.length,0);
    if(length<25)continue;
    const hook=/\?|why|how|never|secret|mistake|lost|imagine|actually|what if|लेकिन|क्यों|गलती|नहीं|実は|なぜ|でも|失敗/i.test(first.text);
    const payoff=/[.!?।。！？]$/.test(last.text.trim());
    const keywords=(text.match(/because|learn|realiz|surpris|remember|laugh|changed|truth|turns out|लेकिन|क्योंकि|समझ|सीखा|सच|本当|理由|だから|気づ|まさか/gi)||[]).length;
    const turns=new Set(group.map(s=>s.speaker).filter(Boolean)).size;
    const energy=group.reduce((n,s)=>n+(s.energy||0),0)/group.length;
    const energyShift=Math.max(...group.map(s=>s.energy||0))-Math.min(...group.map(s=>s.energy||0));
    const questions=group.filter(s=>/[?？]$/.test(s.text.trim())).length;
    const reactions=(text.match(/\b(?:wow|wait|really|exactly|yes|no way|amazing)\b|वाह|सच में|えっ|すごい|本当に/gi)||[]).length;
    const startsClean=!/^(?:and|but|so|because|he|she|they|it|और|लेकिन|तो|そして|でも)\b/i.test(first.text.trim());
    const variety=terms(text).size/Math.max(1,length);
    const score=Math.min(92,35+(hook?15:0)+(payoff?10:0)+(startsClean?5:0)+Math.min(12,keywords*3)+Math.min(6,turns*2)+Math.min(6,energy*90)+Math.min(5,energyShift*120)+Math.min(5,questions*2)+Math.min(5,reactions*2)+Math.min(7,variety*8));
    candidates.push({start:first.start,end:last.end,hook:first.text,context:group.slice(1,-1).map(s=>s.text).join(' ').slice(0,950),payoff:last.text,category:questions?'question-answer':reactions?'reaction':'conversation',reason:'Local ranking: clean opening, hook/payoff, question-answer flow, speaker turns, vocal energy, reactions and topic variety.',score});
  }
  return selectCandidates(candidates,t,options);
}

export function transcriptChunks(t:Transcript) {
  const chunks:typeof t.segments[]=[];let group:typeof t.segments=[];let chars=0;
  for(const s of t.segments){if(chars+s.text.length>14000&&group.length){chunks.push(group);group=group.filter(x=>x.end>group.at(-1)!.end-65);chars=group.reduce((n,x)=>n+x.text.length,0);}group.push(s);chars+=s.text.length;}
  if(group.length)chunks.push(group);return chunks;
}

const assTime=(n:number)=>{const h=Math.floor(n/3600),m=Math.floor(n/60)%60,s=Math.floor(n)%60,c=Math.floor(n*100)%100;return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;};
const escapeAss=(s:string)=>s.replace(/[{}\\]/g,'').replace(/\r?\n/g,' ');

export type CaptionPreset = 'reelmind' | 'karaoke_gold' | 'neon_punch' | 'clean_white';

export interface CaptionOptions {
  preset?: CaptionPreset;
  aspectRatio?: '9:16' | '16:9' | '1:1';
}

export function makeCaptions(words:Word[], options: CaptionOptions = {}):string {
  const isCinema = options.aspectRatio === '16:9';
  const isSquare = options.aspectRatio === '1:1';
  const resX = isCinema ? 1920 : 1080;
  const resY = isCinema ? 1080 : (isSquare ? 1080 : 1920);

  // 9:16 vertical safe area: 520px margin from bottom to stay well above TikTok/Reels UI controls
  const marginV = isCinema ? 140 : (isSquare ? 160 : 520);
  const fontSize = isCinema ? 54 : (isSquare ? 52 : 74);
  const outlineWidth = isCinema ? 4.5 : 6.0;
  const shadowWidth = isCinema ? 2.0 : 2.5;

  const preset = options.preset || 'reelmind';
  let activeColor = '&H00FFF500&'; // Electric Cyan/Teal (BGR byte order: BB=FF, GG=F5, RR=00)
  let emphasisColor = '&H0000E6FF&'; // Neon Gold/Yellow
  let primaryColor = '&H00FFFFFF&'; // Crisp Pure White
  let inactiveColor = '&H00D0D0D0&'; // Soft Silver
  let outlineColor = '&H00121110&'; // Deep dark outline

  if (preset === 'karaoke_gold') {
    activeColor = '&H0000D4FF&';
    emphasisColor = '&H0000A5FF&';
  } else if (preset === 'neon_punch') {
    activeColor = '&H0033FF77&';
    emphasisColor = '&H00F5E133&';
  } else if (preset === 'clean_white') {
    activeColor = '&H00FFB233&';
    emphasisColor = '&H0000D4FF&';
  }

  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${resX}\nPlayResY: ${resY}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans,${fontSize},${primaryColor},${inactiveColor},${outlineColor},&H90000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},${shadowWidth},2,90,90,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  // Dynamic Short-Form Chunking (2-4 words per burst)
  const groups:Word[][]=[];
  let group:Word[]=[];
  let charCount=0;

  for(const w of words) {
    const cleanWord = w.text.trim();
    if (!cleanWord) continue;
    const prev = group.length ? group[group.length - 1] : null;

    const pauseBreak = prev ? (w.start - prev.end > 0.35) : false;
    const punctBreak = prev ? /[.!?।。！？]$/.test(prev.text.trim()) : false;
    const clauseBreak = prev && group.length >= 3 ? /[,:;]$/.test(prev.text.trim()) : false;
    const lengthBreak = group.length >= 4 || (group.length >= 2 && charCount + cleanWord.length > 22);
    const scriptBreak = prev ? ((/[\u3040-\u30ff\u3400-\u9fff]/.test(w.text)) !== (/[\u3040-\u30ff\u3400-\u9fff]/.test(prev.text))) : false;

    if (group.length > 0 && (pauseBreak || punctBreak || clauseBreak || lengthBreak || scriptBreak)) {
      groups.push(group);
      group = [];
      charCount = 0;
    }
    group.push(w);
    charCount += cleanWord.length;
  }
  if(group.length) groups.push(group);

  const lines = groups.flatMap(g => g.map((active, i) => {
    const eventStart = active.start;
    const nextWord = i + 1 < g.length ? g[i + 1] : null;
    const rawEnd = nextWord ? nextWord.start : active.end + 0.08;
    const eventEnd = Math.max(eventStart + 0.04, rawEnd);

    const joined = g.map(w => w.text).join('');
    const font = /[\u0900-\u097f]/.test(joined)
      ? 'Noto Sans Devanagari'
      : /[\u3040-\u30ff\u3400-\u9fff]/.test(joined)
      ? 'Noto Sans JP'
      : 'Noto Sans';

    const formattedWords = g.map((w, j) => {
      const clean = escapeAss(w.text.trim());
      const isEmphasis = /\b(?:never|always|secret|mistake|truth|actually|lesson|changed|best|worst|first|last|huge|money|stop|start|waiting|ready|fail|realize|remember|turns out|discover|matter)\b/iu.test(clean) || /\d+/.test(clean) || /कभी|हमेशा|गलती|सच|सबसे|सीख|शुरू|तैयार|बदलाव|絶対|秘密|本当|一番|失敗|成功|変わる/iu.test(clean);

      if (j === i) {
        const color = isEmphasis ? emphasisColor : activeColor;
        const displayedText = isEmphasis ? clean.toUpperCase() : clean;
        const pop = isEmphasis
          ? `{\\c${color}\\fscx116\\fscy116\\t(0,80,\\fscx108\\fscy108)}`
          : `{\\c${color}\\fscx112\\fscy112\\t(0,70,\\fscx104\\fscy104)}`;
        return `${pop}${displayedText}`;
      } else if (j < i) {
        return `{\\c${primaryColor}\\fscx100\\fscy100}${clean}`;
      } else {
        return `{\\c${inactiveColor}\\fscx100\\fscy100}${clean}`;
      }
    });

    const delimiter = font === 'Noto Sans JP' ? '' : ' ';
    const lineText = formattedWords.join(delimiter);
    const entrance = i === 0 ? '{\\fad(40,30)\\fscx96\\fscy96\\t(0,70,\\fscx100\\fscy100)}' : '';

    return `Dialogue: 0,${assTime(eventStart)},${assTime(eventEnd)},Default,,0,0,0,,{\\fn${font}}${entrance}${lineText}\n`;
  }));

  return header + lines.join('');
}

export function planEdit(c:Candidate,t:Transcript,frames:Frame[],sourceFps=30):EditPlan {
  const words=t.segments.flatMap(s=>s.words).filter(w=>w.start>=c.start&&w.end<=c.end);
  const cuts:{start:number;end:number}[]=[];
  let start=c.start;
  // Only remove very long dead air; keep emotional pauses and enforce at least 25 seconds duration.
  let remaining=c.end-c.start;
  for(let i=1;i<words.length;i++){
    const gap=words[i].start-words[i-1].end;
    if(gap>2.4&&remaining-(gap-.6)>=25.0){
      cuts.push({start,end:words[i-1].end+.3});
      start=words[i].start-.3;
      remaining-=gap-.6;
    }
  }
  cuts.push({start,end:c.end});
  let offset=0;
  for(const cut of cuts) offset += cut.end - cut.start;
  if(offset < 24.8 && c.end - c.start >= 24.8) {
    cuts.length = 0;
    cuts.push({start: c.start, end: c.end});
    offset = c.end - c.start;
  }
  const remap=(n:number)=>{let o=0;for(const cut of cuts){if(n<=cut.end)return o+Math.max(0,n-cut.start);o+=cut.end-cut.start;}return o;};
  const outputWords=words.map(w=>({...w,start:remap(w.start),end:remap(w.end)}));
  const shots:EditPlan['shots']=[];
  const nearest=(time:number)=>frames.reduce<Frame|undefined>((best,f)=>!best||Math.abs(f.time-time)<Math.abs(best.time-time)?f:best,undefined);
  let shotOffset=0;
  for(const cut of cuts){let a=cut.start;while(a<cut.end-.02){
      const min=a+2.7,max=Math.min(a+5.2,cut.end);const boundary=words.filter(w=>w.end>=min&&w.end<=max&&/[.!?।。！？,:;]$/.test(w.text.trim())).at(-1)?.end;
      const currentSpeaker=t.segments.find(x=>x.start<=a&&x.end>=a)?.speaker;const speakerBoundary=t.segments.find(s=>s.start>=min&&s.start<=max&&s.speaker!==currentSpeaker)?.start;
      const end=Math.min(cut.end,speakerBoundary||boundary||max);const frame=nearest(a),endFrame=nearest(Math.max(a,end-.2));const face=frame?.faces.find(f=>f.track===frame.activeTrack)||frame?.faces[0];const endFace=endFrame?.faces.find(f=>f.track===(face?.track??endFrame.activeTrack))||endFrame?.faces[0];const confident=!!frame&&frame.confidence>.65;
      const layout=confident&&face?'portrait':frame?.faces.length===2?'split':'fit';const center=confident&&face?Math.min(.85,Math.max(.15,face.x+face.w/2)):.5;const endCenter=confident&&endFace?Math.min(.85,Math.max(.15,endFace.x+endFace.w/2)):center;
      const transition:EditPlan['shots'][number]['transition']=speakerBoundary?'cut':shots.length%3===0?'punch':'reframe';
      shots.push({start:shotOffset+a-cut.start,end:shotOffset+end-cut.start,center,endCenter,layout,centers:frame?.faces.slice(0,2).map(f=>f.x+f.w/2),zoom:transition==='punch'?1.1:1.03,transition});a=end;
    }
    shotOffset+=cut.end-cut.start;
  }
  const motion=frames.length<2?0:frames.slice(1).reduce((n,f,i)=>n+Math.abs((f.faces[0]?.x||.5)-(frames[i].faces[0]?.x||.5)),0)/(frames.length-1);
  return {version:2,candidate:c,words:outputWords,shots,cuts,duration:offset,captions:makeCaptions(outputWords),fps:sourceFps>=50&&motion>.008?60:30,audio:{sourceOnly:true,lufs:-16}};
}

export function validateClipCandidate(plan: EditPlan, candidate: Candidate): { valid: boolean; reason?: string } {
  if (!plan || !Number.isFinite(plan.duration) || plan.duration < 24.8) {
    return { valid: false, reason: `Duration ${(plan?.duration || 0).toFixed(1)}s under 25s threshold` };
  }
  if (!plan.cuts || plan.cuts.length === 0 || plan.cuts.some(c => c.end <= c.start)) {
    return { valid: false, reason: 'Invalid edit cuts timeline' };
  }
  if (!plan.words || plan.words.length === 0) {
    return { valid: false, reason: 'No transcript words present in clip' };
  }
  if (!plan.captions || !plan.captions.includes('Dialogue:')) {
    return { valid: false, reason: 'English captions missing or invalid' };
  }
  const lastWord = plan.words[plan.words.length - 1];
  if (lastWord && lastWord.end > plan.duration + 0.35) {
    return { valid: false, reason: 'Caption extends beyond clip boundary' };
  }
  if (plan.words.some(w => !w.text.trim())) {
    return { valid: false, reason: 'Empty caption segment detected' };
  }
  if (!plan.audio || plan.audio.sourceOnly !== true) {
    return { valid: false, reason: 'Original spoken audio not preserved' };
  }
  const lastText = plan.words.slice(-3).map(w => w.text).join(' ').trim();
  const hasPayoffPunct = /[.!?।。！？]$/.test(lastText) || /[.!?।。！？]$/.test(candidate.payoff.trim());
  if (!hasPayoffPunct && candidate.score < 80) {
    return { valid: false, reason: 'Clip ends abruptly without completed thought' };
  }
  return { valid: true };
}

