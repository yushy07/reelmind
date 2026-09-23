import type {TranscriptionMode} from '../shared/types';
export async function transcribeWithFallback<T>(requested:TranscriptionMode,effective:TranscriptionMode|undefined,signal:AbortSignal,run:(mode:TranscriptionMode,cpuOnly:boolean)=>Promise<T>,fallback:()=>void):Promise<T>{
  signal.throwIfAborted();
  if(requested==='turbo'&&effective!=='standard'){
    try{return await run('turbo',true);}catch{signal.throwIfAborted();fallback();}
  }
  return run('standard',requested==='turbo');
}
