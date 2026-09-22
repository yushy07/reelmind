import fs from 'node:fs/promises';
import path from 'node:path';
import {run} from '../electron/process';
import {render,probe} from '../electron/media';
import {planEdit} from '../electron/core';
import type {Transcript,Candidate} from '../shared/types';
async function main(){
 const root=path.resolve('.test-data/render');await fs.mkdir(root,{recursive:true});const runtime=path.resolve('runtime');const source=path.join(root,'test-source.mp4');
 await run(path.join(runtime,'ffmpeg.exe'),['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','34','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',source]);
 const texts=['One idea changes everything.','एक छोटी सी सीख सब बदल सकती है।','一つの考えがすべてを変える。'];
 const transcript:Transcript={version:1,duration:34,language:'en',segments:Array.from({length:8},(_,i)=>({start:i*4,end:i*4+3.7,text:texts[i%3],language:['en','hi','ja'][i%3],words:texts[i%3].split(' ').map((text,j,all)=>({start:i*4+j*3.7/all.length,end:i*4+(j+1)*3.7/all.length,text}))}))};
 const candidate:Candidate={start:1,end:33,hook:'Test caption',context:'Multilingual render test',payoff:'Complete.',reason:'test',category:'test',score:90};
 const plan=planEdit(candidate,transcript,[{time:0,faces:[{x:.35,y:.2,w:.2,h:.4,confidence:.99,track:1,motion:.1}],activeTrack:1,confidence:.9}]);
 await render(runtime,source,plan,path.join(root,'reel.mp4'),root,'balanced',{nvenc:true,cpuThreads:4},new AbortController().signal,()=>{});
 await run(path.join(runtime,'ffmpeg.exe'),['-y','-ss','5','-i',path.join(root,'reel.mp4'),'-frames:v','1',path.join(root,'caption.png')]);
 console.log(JSON.stringify(await probe(runtime,path.join(root,'reel.mp4'))));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
