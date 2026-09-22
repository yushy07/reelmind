import fs from 'node:fs/promises';
import path from 'node:path';
import {run} from '../electron/process';
const root=path.resolve('.');
const helper=path.join(root,'workers/credentials.ps1');
const keys:Record<string,string>={};
async function main(){
  for(const provider of ['gemini','openrouter']){
    const key=await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper],{input:JSON.stringify({action:'get',provider})});
    keys[provider]=key;
    if(process.argv.includes('--scan-only'))continue;
    if(!key){console.log(JSON.stringify({provider,stored:false}));continue;}
    try{
      const url=provider==='gemini'?'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1':'https://openrouter.ai/api/v1/key';
      const headers:Record<string,string>=provider==='gemini'?{'x-goog-api-key':key}:{Authorization:`Bearer ${key}`};
      const response=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
      const payload=await response.json().catch(()=>({}));
      console.log(JSON.stringify({provider,stored:true,authenticated:response.ok,httpStatus:response.status,...(provider==='openrouter'&&response.ok?{freeTier:payload.data?.is_free_tier}:{}),...(!response.ok?{reason:payload.error?.status||'Provider rejected authentication'}:{})}));
      if(provider==='openrouter'&&response.ok){
        const completion=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{...headers,'Content-Type':'application/json'},signal:AbortSignal.timeout(45000),body:JSON.stringify({model:'openrouter/free',messages:[{role:'user',content:'Reply with READY only.'}],max_tokens:32})});
        const result=await completion.json().catch(()=>({}));
        console.log(JSON.stringify({provider,freeCompletion:completion.ok&&!!result.choices?.[0]?.message,httpStatus:completion.status}));
      }
    }catch{console.log(JSON.stringify({provider,stored:true,authenticationCheck:'Network error or timeout'}));}
  }
  let checked=0,exposures=0;
  const extensions=/\.(ts|tsx|js|mjs|cjs|json|md|ps1|txt|html|css|sqlite|asar)$/i;
  const inspect=async(file:string)=>{const data=await fs.readFile(file);checked++;if(Object.values(keys).some(key=>key&&data.includes(Buffer.from(key))))exposures++;};
  const visit=async(dir:string)=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(['node_modules','runtime','release','.git'].includes(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isDirectory())await visit(file);else if(extensions.test(entry.name))await inspect(file);}};
  await visit(root);
  const packaged=path.join(root,'release/win-unpacked/resources/app.asar');if(await fs.stat(packaged).catch(()=>null))await inspect(packaged);
  console.log(JSON.stringify({plaintextSecretScan:{filesChecked:checked,exposures}}));
  keys.gemini='';keys.openrouter='';
  if(exposures)process.exitCode=1;
}
main().catch(()=>{console.error('Credential verification failed; no secret details were logged.');process.exitCode=1;});
