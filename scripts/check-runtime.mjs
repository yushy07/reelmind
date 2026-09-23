import { access } from 'node:fs/promises';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('../shared/model-manifest.json',import.meta.url),'utf8'));
for(const spec of manifest.minilm.files){const file='runtime/models/minilm/'+spec.name;if((await stat(file)).size!==spec.size)throw new Error('MiniLM size mismatch');const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);if(hash.digest('hex')!==spec.sha256)throw new Error('MiniLM checksum mismatch');}
if(await stat('runtime/models/whisper-turbo').catch(()=>null))throw new Error('Turbo must not be bundled');
for(const file of ['python/python.exe','ffmpeg.exe','ffprobe.exe','yt-dlp.exe','models/whisper-small/model.bin','models/whisper-small/vocabulary.txt','models/whisper-small/tokenizer.json','models/whisper-small/config.json','models/speaker.onnx','models/face.onnx','fonts/NotoSans-Bold.ttf','fonts/NotoSansDevanagari-Bold.ttf','fonts/NotoSansCJKjp-Bold.otf']){
 try{await access('runtime/'+file);}catch{throw new Error('Missing runtime/'+file+'. Run npm run setup:runtime before packaging.');}
}
