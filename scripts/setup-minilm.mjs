import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
const manifest=JSON.parse(await fs.readFile(new URL('../shared/model-manifest.json',import.meta.url),'utf8')).minilm;
const directory=new URL('../runtime/models/minilm/',import.meta.url);
await fs.mkdir(directory,{recursive:true});
async function valid(file,spec){
  try{if((await fs.stat(file)).size!==spec.size)return false;const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')===spec.sha256;}catch{return false;}
}
for(const spec of manifest.files){
  const file=new URL(spec.name,directory),partial=new URL(spec.name+'.part',directory);
  if(await valid(file,spec))continue;
  const disk=await fs.statfs(directory);if(Number(disk.bavail)*Number(disk.bsize)<spec.size+256e6)throw new Error('Insufficient disk space for MiniLM');
  console.log(`Downloading MiniLM ${spec.name}`);
  const response=await fetch(`https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${spec.remote}`,{signal:AbortSignal.timeout(600000)});
  if(!response.ok||!response.body)throw new Error(`Download failed (${response.status})`);
  await pipeline(Readable.fromWeb(response.body),createWriteStream(partial));
  if(!await valid(partial,spec))throw new Error('MiniLM checksum mismatch');
  await fs.rename(partial,file);
}
console.log('Pinned MiniLM model verified');
