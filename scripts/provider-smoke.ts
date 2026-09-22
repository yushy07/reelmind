import fs from 'node:fs/promises';
import path from 'node:path';
import {analyze} from '../electron/providers';
import {Store} from '../electron/storage';
import {run} from '../electron/process';
async function main(){
 const store=new Store(path.join(process.env.APPDATA!,'reelmind/reelmind.sqlite'));const settings=store.settings();store.db.close();
 const work=path.resolve('.test-data/pipeline/work');let transcript;
 for(const id of await fs.readdir(work)){try{transcript=JSON.parse(await fs.readFile(path.join(work,id,'transcript.json'),'utf8'));if(transcript.segments?.length)break;}catch{}}
 if(!transcript)throw new Error('Generate the speech fixture and run the pipeline test first.');
 const providers:string[]=[];
 const candidates=await analyze(transcript,settings,provider=>run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('workers/credentials.ps1')],{input:JSON.stringify({action:'get',provider})}),AbortSignal.timeout(120000),message=>{providers.push(message);console.log(message);});
 console.log(JSON.stringify({candidates:candidates.length,boundsValid:candidates.every(c=>c.end-c.start>=30&&c.end-c.start<=60),usedGeneratedTestTranscript:true,steps:providers}));
}
main().catch(()=>{console.error('Provider integration test could not complete. No credentials were logged.');process.exitCode=1;});
