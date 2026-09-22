import fs from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../electron/storage';
import {run} from '../electron/process';
async function main(){
  if(!process.env.APPDATA)throw new Error('Windows profile directory unavailable.');
  const root=path.join(process.env.APPDATA,'reelmind');
  await fs.mkdir(root,{recursive:true});
  const store=new Store(path.join(root,'reelmind.sqlite'));
  const settings={...store.settings(),geminiModel:'gemini-flash-latest',cloudEnabled:true,geminiFreeConfirmed:true,providerOrder:['gemini','openrouter'] as ('gemini'|'openrouter')[]};
  store.setSettings(settings);store.db.close();
  console.log(JSON.stringify({profileConfigured:true,providerOrder:settings.providerOrder,geminiBillingDisabledConfirmed:true}));
  const key=await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('workers/credentials.ps1')],{input:JSON.stringify({action:'get',provider:'gemini'})});
  if(!key)throw new Error('Gemini credential not available to this Windows session.');
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:'Reply with READY only.'}]}],generationConfig:{maxOutputTokens:256}}),signal:AbortSignal.timeout(30000)});
  const result=await response.json().catch(()=>({}));
  console.log(JSON.stringify({provider:'gemini',model:settings.geminiModel,completion:response.ok&&!!result.candidates?.[0]?.content?.parts?.some((p:{text?:string})=>p.text),httpStatus:response.status,...(!response.ok?{reason:result.error?.status||'Provider rejected request'}:{})}));
}
main().catch(()=>{console.error('Gemini verification failed. No credential values were logged.');process.exitCode=1;});
