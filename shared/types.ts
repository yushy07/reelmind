export type Stage = 'queued'|'importing'|'transcribing'|'analyzing'|'framing'|'rendering'|'completed'|'paused'|'failed'|'expired';
export type Provider = 'gemini'|'openrouter';
export interface Word { start:number; end:number; text:string; probability?:number }
export interface Segment { start:number; end:number; text:string; language:string; speaker?:string; energy?:number; words:Word[] }
export interface Transcript { version:1; duration:number; language:string; segments:Segment[] }
export interface Candidate { start:number; end:number; hook:string; context:string; payoff:string; category:string; reason:string; score:number }
export interface Face { x:number; y:number; w:number; h:number; confidence:number; track:number; motion:number }
export interface Frame { time:number; faces:Face[]; activeTrack?:number; confidence:number }
export interface EditPlan { version:2; candidate:Candidate; words:Word[]; shots:{start:number;end:number;center:number;endCenter:number;layout:'portrait'|'fit'|'split';centers?:number[];zoom:number;transition:'cut'|'punch'|'reframe'}[]; cuts:{start:number;end:number}[]; duration:number; captions:string; fps:30|60; audio:{sourceOnly:true;lufs:number} }
export interface Reel { id:string; title:string; duration:number; file:string; savedPath?:string; reason:string }
export interface Job { id:string; title:string; input:{kind:'local'|'url';value:string}; stage:Stage; checkpoint:Stage; progress:number; message:string; createdAt:number; updatedAt:number; cleanupAt?:number; workingDeleted?:boolean; outputs:Reel[]; provider:string; error?:string; duration?:number }
export interface Settings { providerOrder:Provider[]; geminiModel:string; openrouterModel:string; quality:'balanced'|'high'; cloudEnabled:boolean; geminiFreeConfirmed:boolean }
export interface Status { jobs:Job[]; settings:Settings; keys:Record<Provider,boolean>; runtime:{ready:boolean;missing:string[]}; hardware:string; setup:{running:boolean;message:string;error?:string} }
export interface API { status():Promise<Status>; pickVideo():Promise<string|null>; create(input:Job['input']):Promise<string>; action(id:string,action:'pause'|'resume'|'delete'):Promise<void>; save(id:string):Promise<string|null>; settings(settings:Settings,keys:Partial<Record<Provider,string>>):Promise<void>; setup():Promise<void>; subscribe(callback:()=>void):()=>void; onReady(callback:(id:string)=>void):()=>void }
