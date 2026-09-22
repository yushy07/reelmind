import path from 'node:path';
import {run} from '../electron/process';
async function main(){
 const title=await run(path.resolve('runtime/yt-dlp.exe'),['--ignore-config','--no-playlist','--skip-download','--js-runtimes',`node:${path.resolve('node_modules/electron/dist/electron.exe')}`,'--no-cache-dir','--print','title','--','https://www.youtube.com/watch?v=aqz-KE-bpKQ'],{env:{ELECTRON_RUN_AS_NODE:'1'},signal:AbortSignal.timeout(45000)});
 console.log('Public YouTube metadata read: '+title.trim());
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
