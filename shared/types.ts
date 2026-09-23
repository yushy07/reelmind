export type Studio = 'podcast' | 'anime';
export type AnimeLanguage = 'ja' | 'en';
export type Stage = 'queued'|'importing'|'transcribing'|'analyzing'|'framing'|'rendering'|'scenes'|'music'|'candidates'|'completed'|'paused'|'failed'|'expired';
export type Provider = 'gemini'|'openrouter';
export type TranscriptionMode='standard'|'turbo';
export type TranscriptTimingSource='provided'|'estimated'|'whisper';
export interface ModelStatus {ready:boolean;running:boolean;downloaded:number;total:number;freeBytes:number;message:string;error?:string}
export interface Word { start:number; end:number; text:string; probability?:number }
export interface Segment { start:number; end:number; text:string; language:string; speaker?:string; energy?:number; words:Word[] }
export interface Transcript { version:1; duration:number; language:string; segments:Segment[]; timingSource?:TranscriptTimingSource }
export interface Candidate { start:number; end:number; hook:string; context:string; payoff:string; category:string; reason:string; score:number }
export interface Face { x:number; y:number; w:number; h:number; confidence:number; track:number; motion:number }
export interface Frame { time:number; faces:Face[]; activeTrack?:number; confidence:number }
export interface EditPlan { version:2; candidate:Candidate; words:Word[]; shots:{start:number;end:number;center:number;endCenter:number;layout:'portrait'|'fit'|'split';centers?:number[];zoom:number;transition:'cut'|'punch'|'reframe'}[]; cuts:{start:number;end:number}[]; duration:number; captions:string; fps:30|60; audio:{sourceOnly:true;lufs:number} }
export interface Reel { id:string; title:string; duration:number; file:string; savedPath?:string; reason:string; planHash?:string }

export interface AnimeShot {
  id: number;
  start: number;
  end: number;
  duration: number;
  keyframeTime?: number;
  motionScore?: number;
  impactScore?: number;
  impactTime?: number;
}

export interface MusicSection {
  start: number;
  end: number;
  energy: number;
  label?: string;
}

export interface MusicMap {
  duration: number;
  bpm: number;
  beats: number[];
  downbeats?: number[];
  strongBeats?: number[];
  energySections?: MusicSection[];
  onsetTimes?: number[];
}

export interface AnimeEpisodeMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
}

export type AnimeCandidateCategory = 'action' | 'emotional' | 'dialogue' | 'cinematic';

export interface AnimeCandidate {
  id: number;
  shotId: number;
  start: number;
  end: number;
  duration: number;
  impactTime: number;
  motionScore: number;
  faceScore: number;
  audioEnergyScore: number;
  transientScore: number;
  impactScore: number;
  totalScore: number;
  category: AnimeCandidateCategory;
  hasDialogue: boolean;
  dialogueText?: string;
  facesCount: number;
  maxFaceRatio: number;
  motionPeak?: number;
  transientPeak?: number;
}

export interface AnimeEpisodeAnalysis {
  version: 1;
  metadata: AnimeEpisodeMetadata;
  language: AnimeLanguage;
  shotCount: number;
  dialogueCount: number;
  musicBpm?: number;
  candidatesCount?: number;
  candidates?: AnimeCandidate[];
}

export interface AnimeCreateInput {
  kind: 'local';
  episodePath: string;
  musicPath: string;
  language: AnimeLanguage;
  name?: string;
  outputAspect?: '9:16' | '16:9' | '1:1';
}

export interface Job {
  id:string;
  studio?:Studio;
  name?:string;
  title:string;
  input:{kind:'local'|'url';value:string;name?:string;musicPath?:string;language?:AnimeLanguage};
  stage:Stage;
  checkpoint:Stage;
  progress:number;
  message:string;
  createdAt:number;
  updatedAt:number;
  cleanupAt?:number;
  workingDeleted?:boolean;
  outputs:Reel[];
  provider:string;
  fallbacks?:string[];
  error?:string;
  duration?:number;
  transcriptionMode?:TranscriptionMode;
  modelRevision?:string;
  effectiveTranscriptionMode?:TranscriptionMode;
  transcriptSource?:'pasted'|'whisper';
  transcriptTiming?:TranscriptTimingSource;
  animeAnalysis?: {
    shotCount?: number;
    bpm?: number;
    beatsCount?: number;
    language?: AnimeLanguage;
    candidatesCount?: number;
    candidates?: AnimeCandidate[];
  };
}

export type CreateInput = Job['input'] & {pastedTranscript?:string}
export interface Settings { providerOrder:Provider[]; geminiModel:string; openrouterModel:string; quality:'balanced'|'high'; cloudEnabled:boolean; geminiFreeConfirmed:boolean; transcriptionMode?:TranscriptionMode }
export interface Status { jobs:Job[]; settings:Settings; keys:Record<Provider,boolean>; runtime:{ready:boolean;missing:string[]}; hardware:string; setup:{running:boolean;message:string;error?:string}; turbo:ModelStatus }
export interface API {
  status():Promise<Status>;
  pickVideo():Promise<string|null>;
  pickAudio?():Promise<string|null>;
  create(input:CreateInput):Promise<string>;
  createAnime?(input:AnimeCreateInput):Promise<string>;
  action(id:string,action:'pause'|'resume'|'delete'):Promise<void>;
  save(id:string):Promise<string|null>;
  settings(settings:Settings,keys:Partial<Record<Provider,string>>):Promise<void>;
  setup():Promise<void>;
  turbo(action:'download'|'cancel'):Promise<void>;
  subscribe(callback:()=>void):()=>void;
  onReady(callback:(id:string)=>void):()=>void;
}
