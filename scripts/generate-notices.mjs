import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve('.');
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
const packages=[];
for(const [location,meta] of Object.entries(lock.packages||{})){
  if(!location.startsWith('node_modules/')||!meta.version)continue;
  const name=location.slice('node_modules/'.length);packages.push({name,version:meta.version,license:meta.license||'See package metadata'});
}
const python=[];const site=path.join(root,'runtime/python/Lib/site-packages');
for(const entry of await fs.readdir(site,{withFileTypes:true}).catch(()=>[])){
  if(!entry.isDirectory()||!entry.name.endsWith('.dist-info'))continue;
  const metadata=await fs.readFile(path.join(site,entry.name,'METADATA'),'utf8').catch(()=>'');
  const field=name=>metadata.match(new RegExp(`^${name}: (.+)$`,'m'))?.[1]?.trim();
  python.push({name:field('Name')||entry.name,version:field('Version')||'',license:field('License-Expression')||field('License')||'See distribution metadata'});
}
const rows=items=>items.sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`| ${x.name.replaceAll('|','\\|')} | ${x.version} | ${String(x.license).replaceAll('|','\\|')} |`).join('\n');
const output=`# Third-party license inventory\n\nGenerated from the dependencies packaged with REELMIND ${new Date().toISOString().slice(0,10)}. Package metadata and license files remain in the distributed runtime. This inventory does not change any upstream license.\n\n## Major runtime components\n\n| Component | Version/source | License |\n|---|---|---|\n| Electron | package lock | MIT and bundled Chromium notices |\n| FFmpeg | BtbN n9.0 Windows LGPL build ([source/build definitions](https://github.com/BtbN/FFmpeg-Builds), [FFmpeg source](https://github.com/FFmpeg/FFmpeg/tree/n9.0)) | LGPL-3.0-or-later |\n| yt-dlp | packaged executable ([source](https://github.com/yt-dlp/yt-dlp)) | Unlicense |\n| faster-whisper small model | [Systran model](https://huggingface.co/Systran/faster-whisper-small) | MIT |\n| Multilingual MiniLM-L12-v2 | [Pinned ONNX model](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) | Apache-2.0 |\n| Whisper large-v3-turbo (optional download) | [CTranslate2 model](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo) | MIT |\n| OpenCV YuNet model | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | Apache-2.0 |\n| Sherpa ONNX speaker model/runtime | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Apache-2.0 |\n| Noto fonts | [Google Noto](https://github.com/notofonts) | OFL-1.1 |\n\n## JavaScript packages\n\n| Package | Version | Declared license |\n|---|---:|---|\n${rows(packages)}\n\n## Python packages\n\n| Package | Version | Declared license |\n|---|---:|---|\n${rows(python)}\n`;
await fs.writeFile(path.join(root,'THIRD_PARTY_LICENSES.md'),output);
