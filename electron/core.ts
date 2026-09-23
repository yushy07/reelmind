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
export function selectCandidates(candidates:Candidate[],t:Transcript,options:{limit?:number;lexical?:boolean}={}):Candidate[] {
  const selected:Candidate[]=[];
  for(const raw of [...candidates].sort((a,b)=>b.score-a.score)) {
    if(!candidateSchema.safeParse(raw).success||raw.score<56) continue;
    const words=t.segments.flatMap(s=>s.words);
    const first=words.find(w=>w.end>raw.start), last=[...words].reverse().find(w=>w.start<raw.end);
    if(!first||!last)continue;
    const c={...raw,start:Math.max(0,first.start-.06),end:Math.min(t.duration,last.end+.12)};
    if(c.end-c.start<30||c.end-c.start>60)continue;
    if(selected.some(p=>Math.max(0,Math.min(c.end,p.end)-Math.max(c.start,p.start))/Math.min(c.end-c.start,p.end-p.start)>.3||(options.lexical!==false&&similarity(c.hook+' '+c.context,p.hook+' '+p.context)>.6)))continue;
    selected.push(c); if(selected.length===(options.limit??12))break;
  }
  return selected;
}
export function localCandidates(t:Transcript,options:{limit?:number;lexical?:boolean}={}):Candidate[] {
  const candidates:Candidate[]=[];
  for(let i=0;i<t.segments.length;i++) {
    const first=t.segments[i]; const group=[];
    for(let j=i;j<t.segments.length;j++){if(t.segments[j].end-first.start>59.5)break;group.push(t.segments[j]);}
    if(!group.length)continue;
    const last=group.at(-1)!;if(last.end-first.start<30)continue;
    const text=group.map(s=>s.text).join(' '),length=group.reduce((n,s)=>n+s.words.length,0);
    if(length<35)continue;
    const hook=/\?|why|how|never|secret|mistake|lost|imagine|actually|what if|लेकिन|क्यों|गलती|नहीं|実は|なぜ|でも|失敗/i.test(first.text);
    const payoff=/[.!?。！？]$/.test(last.text.trim());
    const keywords=(text.match(/because|learn|realiz|surpris|remember|laugh|changed|truth|turns out|लेकिन|क्योंकि|समझ|सीखा|सच|本当|理由|だから|気づ|まさか/gi)||[]).length;
    const turns=new Set(group.map(s=>s.speaker).filter(Boolean)).size;
    const energy=group.reduce((n,s)=>n+(s.energy||0),0)/group.length;
    const energyShift=Math.max(...group.map(s=>s.energy||0))-Math.min(...group.map(s=>s.energy||0));
    const questions=group.filter(s=>/[?？]$/.test(s.text.trim())).length;
    const reactions=(text.match(/\b(?:wow|wait|really|exactly|yes|no way|amazing)\b|वाह|सच में|えっ|すごい|本当に/gi)||[]).length;
    const startsClean=!/^(?:and|but|so|because|he|she|they|it|और|लेकिन|तो|そして|でも)\b/i.test(first.text.trim());
    const variety=terms(text).size/Math.max(1,length);
    const score=Math.min(92,30+(hook?15:0)+(payoff?9:0)+(startsClean?5:0)+Math.min(12,keywords*3)+Math.min(6,turns*2)+Math.min(6,energy*90)+Math.min(5,energyShift*120)+Math.min(5,questions*2)+Math.min(5,reactions*2)+Math.min(7,variety*8));
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
export function makeCaptions(words:Word[]):string {
  const header='[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans,68,&H00FFFFFF,&H00FFFFFF,&H00201916,&H90000000,-1,0,0,0,100,100,0,0,1,5,2,2,90,180,430,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const groups:Word[][]=[];let group:Word[]=[];let size=0;
  for(const w of words){if(group.length&&(size+w.text.length>26||group.length>=5||w.start-group.at(-1)!.end>.45||/[.!?।。！？]$/.test(group.at(-1)!.text.trim())||(/[\u3040-\u30ff\u3400-\u9fff]/.test(w.text)!==/[\u3040-\u30ff\u3400-\u9fff]/.test(group.at(-1)!.text)))){groups.push(group);group=[];size=0;}group.push(w);size+=w.text.length;}
  if(group.length)groups.push(group);
  return header+groups.flatMap(g=>g.map((active,i)=>{
    const end=i+1<g.length?Math.min(g[i+1].start,active.end+.15):active.end+.06;
    const font=/[\u0900-\u097f]/.test(g.map(w=>w.text).join(''))?'Noto Sans Devanagari':/[\u3040-\u30ff\u3400-\u9fff]/.test(g.map(w=>w.text).join(''))?'Noto Sans JP':'Noto Sans';
    const emphasis=/\b(?:never|always|secret|mistake|truth|changed|best|worst|first|last)\b|कभी|हमेशा|गलती|सच|सबसे|絶対|秘密|本当|一番|\d+/iu.test(active.text);
    const text=g.map((w,j)=>`{\\c${j===i?'&H0061E9D1&':'&H00FFFFFF&'}${j===i&&emphasis?'\\fscx112\\fscy112':''}}${escapeAss(w.text.trim())}`).join(font==='Noto Sans JP'?'':' ');
    return `Dialogue: 0,${assTime(active.start)},${assTime(Math.max(active.start+.03,end))},Default,,0,0,0,,{\\fn${font}\\fad(45,55)\\fscx94\\fscy94\\t(0,110,\\fscx100\\fscy100)}${text}\n`;
  })).join('');
}
export function planEdit(c:Candidate,t:Transcript,frames:Frame[],sourceFps=30):EditPlan {
  const words=t.segments.flatMap(s=>s.words).filter(w=>w.start>=c.start&&w.end<=c.end);
  const cuts:{start:number;end:number}[]=[];
  let start=c.start;
  // Only remove very long dead air; keep emotional pauses and enforce 30 seconds.
  let remaining=c.end-c.start;
  for(let i=1;i<words.length;i++){const gap=words[i].start-words[i-1].end;if(gap>2.4&&remaining-(gap-.6)>=30){cuts.push({start,end:words[i-1].end+.3});start=words[i].start-.3;remaining-=gap-.6;}}
  cuts.push({start,end:c.end});
  const remap=(n:number)=>{let offset=0;for(const cut of cuts){if(n<=cut.end)return offset+Math.max(0,n-cut.start);offset+=cut.end-cut.start;}return offset;};
  const outputWords=words.map(w=>({...w,start:remap(w.start),end:remap(w.end)}));
  const shots:EditPlan['shots']=[];let offset=0;
  const nearest=(time:number)=>frames.reduce<Frame|undefined>((best,f)=>!best||Math.abs(f.time-time)<Math.abs(best.time-time)?f:best,undefined);
  for(const cut of cuts){let a=cut.start;while(a<cut.end-.02){
      const min=a+2.7,max=Math.min(a+5.2,cut.end);const boundary=words.filter(w=>w.end>=min&&w.end<=max&&/[.!?।。！？,:;]$/.test(w.text.trim())).at(-1)?.end;
      const currentSpeaker=t.segments.find(x=>x.start<=a&&x.end>=a)?.speaker;const speakerBoundary=t.segments.find(s=>s.start>=min&&s.start<=max&&s.speaker!==currentSpeaker)?.start;
      const end=Math.min(cut.end,speakerBoundary||boundary||max);const frame=nearest(a),endFrame=nearest(Math.max(a,end-.2));const face=frame?.faces.find(f=>f.track===frame.activeTrack)||frame?.faces[0];const endFace=endFrame?.faces.find(f=>f.track===(face?.track??endFrame.activeTrack))||endFrame?.faces[0];const confident=!!frame&&frame.confidence>.65;
      const layout=confident&&face?'portrait':frame?.faces.length===2?'split':'fit';const center=confident&&face?Math.min(.85,Math.max(.15,face.x+face.w/2)):.5;const endCenter=confident&&endFace?Math.min(.85,Math.max(.15,endFace.x+endFace.w/2)):center;
      const transition:EditPlan['shots'][number]['transition']=speakerBoundary?'cut':shots.length%3===0?'punch':'reframe';
      shots.push({start:offset+a-cut.start,end:offset+end-cut.start,center,endCenter,layout,centers:frame?.faces.slice(0,2).map(f=>f.x+f.w/2),zoom:transition==='punch'?1.1:1.03,transition});a=end;
    }
    offset+=cut.end-cut.start;
  }
  const motion=frames.length<2?0:frames.slice(1).reduce((n,f,i)=>n+Math.abs((f.faces[0]?.x||.5)-(frames[i].faces[0]?.x||.5)),0)/(frames.length-1);
  return {version:2,candidate:c,words:outputWords,shots,cuts,duration:offset,captions:makeCaptions(outputWords),fps:sourceFps>=50&&motion>.008?60:30,audio:{sourceOnly:true,lufs:-16}};
}
