import {spawn} from 'node:child_process';
import path from 'node:path';
const child=spawn(path.resolve('release/win-unpacked/REELMIND.exe'),['--self-test'],{stdio:'inherit',windowsHide:true});
const timer=setTimeout(()=>{child.kill();console.error('Packaged self-test timed out');process.exitCode=1;},60000);
child.on('exit',code=>{clearTimeout(timer);process.exit(code||0);});
