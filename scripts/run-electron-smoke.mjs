import {spawn} from 'node:child_process';
import electron from 'electron';
const child=spawn(electron,['scripts/electron-smoke.cjs'],{stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exit(code||0));
