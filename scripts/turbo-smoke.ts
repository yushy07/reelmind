import path from 'node:path';
import fs from 'node:fs/promises';
import {ModelManager} from '../electron/models';
import {run} from '../electron/process';
async function main(){
 const root=path.resolve('.test-data/turbo');let last=-1;
 const manager=new ModelManager(root,()=>{const n=Math.floor(manager.state.downloaded/manager.state.total*100);if(n!==last){console.log(`${n}% ${manager.state.message}`);last=n;}});
 await manager.init();if(!manager.state.ready)await manager.download(new AbortController().signal);
 const output=path.join(root,'transcript.json');
 await run(path.resolve('runtime/python/python.exe'),[path.resolve('workers/worker.py'),'transcribe','--input',path.resolve('.test-data/audit/speech.wav'),'--output',output,'--models',path.resolve('runtime/models'),'--model-path',manager.directory()],{progress:console.log});
 const transcript=JSON.parse(await fs.readFile(output,'utf8'));if(!transcript.segments.length)throw new Error('No transcript');console.log(JSON.stringify({turbo:true,cpuInt8:true,segments:transcript.segments.length}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
