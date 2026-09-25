import { spawn } from 'node:child_process';
export async function run(exe:string,args:string[],options:{signal?:AbortSignal;cwd?:string;input?:string;env?:Record<string,string>;progress?:(line:string)=>void}={}):Promise<string> {
  options.signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd:options.cwd,env:{...process.env,...options.env},windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});let output='',errors='',pending='';
    let cleanup=()=>{};
    if(options.signal){
      const abort=()=>{if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}else child.kill();};
      options.signal.addEventListener('abort',abort,{once:true});
      cleanup=()=>options.signal?.removeEventListener('abort',abort);
    }
    child.stdout.on('data',(data:Buffer)=>{const s=data.toString();output=(output+s).slice(-32_000_000);pending+=s;const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines)options.progress?.(line);});
    child.stderr.on('data',(data:Buffer)=>{errors=(errors+data.toString()).slice(-6000);});
    child.once('error',err=>{cleanup();reject(err);});
    child.once('close',code=>{cleanup();if(options.signal?.aborted)reject(new Error('Processing interrupted'));else if(code!==0)reject(new Error(errors||`Worker exited with code ${code}`));else resolve(output);});
    child.stdin.on('error',()=>{});child.stdin.end(options.input||'');
  });
}
