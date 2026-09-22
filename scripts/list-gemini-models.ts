import path from 'node:path';
import {run} from '../electron/process';
async function main(){
 const key=await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('workers/credentials.ps1')],{input:JSON.stringify({action:'get',provider:'gemini'})});
 const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(20000)});
 const data=await response.json();
 console.log(JSON.stringify({status:response.status,models:data.models?.filter((m:any)=>m.supportedGenerationMethods?.includes('generateContent')&&/flash/.test(m.name)).map((m:any)=>({name:m.name,displayName:m.displayName})),hasNextPage:!!data.nextPageToken}));
}
main().catch(()=>{console.error('Model discovery failed.');process.exitCode=1;});
