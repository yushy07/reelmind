import { access } from 'node:fs/promises';
for(const file of ['python/python.exe','ffmpeg.exe','ffprobe.exe','yt-dlp.exe','models/whisper-small/model.bin','models/whisper-small/vocabulary.txt','models/whisper-small/tokenizer.json','models/whisper-small/config.json','models/speaker.onnx','models/face.onnx','fonts/NotoSans-Bold.ttf','fonts/NotoSansDevanagari-Bold.ttf','fonts/NotoSansCJKjp-Bold.otf']){
 try{await access('runtime/'+file);}catch{throw new Error('Missing runtime/'+file+'. Run npm run setup:runtime before packaging.');}
}
