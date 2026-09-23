import type {Segment, Transcript, Word} from '../shared/types';

export const MAX_PASTED_TRANSCRIPT_CHARS=200_000;
const timecode=String.raw`(?:[0-9]{1,}:)?[0-5]?[0-9]:[0-5]?[0-9][,.][0-9]{1,3}`;
const cueLine=new RegExp(`^[ \\t]*(${timecode})[ \\t]*-->[ \\t]*(${timecode})(?:[ \\t]+.*)?[ \\t]*$`);

function seconds(value:string){
  const parts=value.replace(',','.').split(':');
  const [wholeSeconds,fractionalSeconds='0']=parts.pop()!.split('.');
  const fraction=Number(`0.${fractionalSeconds||'0'}`);
  const seconds=Number(wholeSeconds),minutes=Number(parts.pop()),hours=Number(parts.pop()||0);
  return hours*3600+minutes*60+seconds+fraction;
}
const htmlEntities:Record<string,string>={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
function decodeEntity(entity:string,code:string){
  if(code[0]==='#'){
    const hexadecimal=code[1]?.toLowerCase()==='x';
    const point=Number.parseInt(code.slice(hexadecimal?2:1),hexadecimal?16:10);
    if(!Number.isInteger(point)||point<0||point>0x10ffff||(point>=0xd800&&point<=0xdfff))return entity;
    return String.fromCodePoint(point);
  }
  return htmlEntities[code.toLowerCase()]??entity;
}
function clean(value:string){return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi,(entity,code:string)=>decodeEntity(entity,code)).replace(/<[^>]*>/g,'').replace(/\s+/gu,' ').trim();}
function language(value:string){
  if(/[\u3040-\u30ff\u3400-\u9fff]/u.test(value))return 'ja';
  if(/[\u0900-\u097f]/u.test(value))return 'hi';
  if(/[\p{Script=Latin}]/u.test(value))return 'en';
  return 'und';
}
function tokenize(value:string){return value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,4}|[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)?|[^\s]/gu)||[];}
function readCues(source:string){
  const cues:{start:number;end:number;text:string}[]=[];let foundTimestamp=false;
  for(const block of source.split(/\n\s*\n/u)){
    const lines=block.split('\n'),index=lines.findIndex(line=>line.includes('-->'));if(index<0)continue;
    foundTimestamp=true;const match=lines[index].match(cueLine);if(!match)throw new Error('A transcript timestamp is not in SRT or VTT format.');
    const start=seconds(match[1]),end=seconds(match[2]),text=clean(lines.slice(index+1).join(' '));
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('A transcript cue has an invalid time range.');
    if(text)cues.push({start,end,text});
  }
  if(foundTimestamp){if(!cues.length)throw new Error('No readable subtitle lines were found after the timestamps.');return {cues,estimated:false};}
  if(source.includes('-->'))throw new Error('A transcript timestamp is not in SRT or VTT format.');
  const plain=source.replace(/^\uFEFF/u,'').split('\n').filter(line=>!/^\s*(?:WEBVTT|NOTE\b|STYLE\b|REGION\b)/iu.test(line)).map(clean).filter(Boolean).join(' ');
  if(!plain)throw new Error('Paste transcript text or SRT/VTT cues.');
  return {cues:[{start:0,end:0,text:plain}],estimated:true};
}
function cueWords(cue:{start:number;end:number;text:string},duration:number,estimated:boolean){
  const tokens=tokenize(cue.text),weights=tokens.map(token=>Math.max(1,[...token].length)),total=weights.reduce((sum,n)=>sum+n,0);
  const start=estimated?0:cue.start,end=estimated?duration:cue.end,span=end-start;let offset=0;
  return tokens.map((text,index)=>{const wordStart=start+span*offset/total;offset+=weights[index];const wordEnd=index===tokens.length-1?end:start+span*offset/total;return {start:wordStart,end:wordEnd,text};});
}
export function parsePastedTranscript(value:string,duration:number):Transcript{
  const source=value.replace(/\r\n?/gu,'\n').replace(/^\uFEFF/u,'').trim();
  if(!source)throw new Error('Paste transcript text or leave it blank to transcribe the video.');
  if(source.length>MAX_PASTED_TRANSCRIPT_CHARS)throw new Error('Transcript is too long. Keep it under 200,000 characters.');
  if(!Number.isFinite(duration)||duration<1)throw new Error('The video duration is not valid for transcript timing.');
  const {cues,estimated}=readCues(source),items:{word:Word;language:string}[]=[];
  for(const cue of cues){if(!estimated&&cue.start>=duration)continue;const bounded={...cue,end:estimated?duration:Math.min(cue.end,duration)};if(bounded.end<=bounded.start)continue;items.push(...cueWords(bounded,duration,estimated).map(word=>({word,language:language(cue.text)})));}
  if(!items.length)throw new Error('None of the transcript timestamps fall inside this video.');
  const segments:Segment[]=[];let group:{word:Word;language:string}[]=[];
  const flush=()=>{if(!group.length)return;const lang=group[Math.floor(group.length/2)].language;segments.push({start:group[0].word.start,end:group.at(-1)!.word.end,text:group.map(item=>item.word.text).join(lang==='ja'?'':' '),language:lang,words:group.map(item=>item.word)});group=[];};
  for(const item of items){const previous=group.at(-1);if(previous&&(item.language!==previous.language||item.word.start-previous.word.end>.8||item.word.start-group[0].word.start>=5||/[.!?।。！？]$/u.test(previous.word.text)))flush();group.push(item);}
  flush();return {version:1,duration,language:language(source),segments,timingSource:estimated?'estimated':'provided'};
}
