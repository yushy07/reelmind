"""JSON-lines worker. Models stay local; stdout contains progress, never credentials."""
import argparse
import json
import os
from pathlib import Path
import sys

def emit(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)

def save(file, data):
    temp = str(file) + '.tmp'
    Path(temp).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, file)

def transcribe(args):
    import numpy as np
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio
    audio = decode_audio(args.input, sampling_rate=16000)
    model_path = str(Path(args.models) / 'whisper-small')
    def run_model(model, device):
        result = []
        # Re-detect language every 30 seconds, allowing Hindi/English/Japanese switches.
        for start in range(0, len(audio), 30 * 16000):
            offset = start / 16000
            chunk = audio[start:start + 30 * 16000]
            provisional, _ = model.transcribe(chunk, beam_size=5, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
            provisional = list(provisional)
            for s in provisional:
                if s.no_speech_prob > .75 or not s.words:
                    continue
                sample_start=max(0, int((s.start-.2)*16000));sample_end=min(len(chunk),int((s.end+.2)*16000));sample=chunk[sample_start:sample_end]
                language, probability, _ = model.detect_language(audio=sample, vad_filter=False)
                if probability < .45:
                    language='en'
                refined, _ = model.transcribe(sample, beam_size=5, word_timestamps=True, vad_filter=False, language=language, condition_on_previous_text=False)
                base=offset+sample_start/16000
                for part in refined:
                    if part.no_speech_prob > .75 or not part.words:
                        continue
                    words = [{'start': w.start + base, 'end': w.end + base, 'text': w.word, 'probability': w.probability} for w in part.words if w.end > w.start]
                    if words:
                        result.append({'start': words[0]['start'], 'end': words[-1]['end'], 'text': part.text.strip(), 'language': language, 'language_probability': probability, 'energy': float(np.sqrt(np.mean(sample**2))) if len(sample) else 0, 'words': words})
            emit(progress=min(.99, (start + len(chunk))/len(audio)), message=f'Transcribing speech locally · {device}')
        return result
    result = None
    if args.gpu:
        try:
            emit(progress=0, message='Starting GPU speech recognition')
            model = WhisperModel(model_path, device='cuda', compute_type='float16', local_files_only=True)
            result = run_model(model, 'GPU')
        except Exception:
            emit(fallback='GPU speech unavailable; using CPU instead', message='GPU speech unavailable · continuing on CPU')
    if result is None:
        model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
        result = run_model(model, 'CPU')
    if not result:
        raise ValueError('No clear speech found in this video.')
    save(args.output, {'version': 1, 'duration': len(audio)/16000, 'language': result[0]['language'], 'segments': result})

def frame_video(args):
    import cv2
    import numpy as np
    import sherpa_onnx
    from faster_whisper.audio import decode_audio
    transcript = json.loads(Path(args.transcript).read_text(encoding='utf-8'))
    audio = decode_audio(args.audio, sampling_rate=16000)
    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(Path(args.models)/'speaker.onnx'), num_threads=2, provider='cpu')
    if not config.validate():
        raise ValueError('Speaker model is missing or invalid. Run setup again.')
    extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
    centroids = []
    for s in transcript['segments']:
        sample = audio[int(s['start']*16000):int(s['end']*16000)]
        if len(sample) < 16000:
            continue
        stream = extractor.create_stream()
        stream.accept_waveform(sample_rate=16000, waveform=sample)
        stream.input_finished()
        if not extractor.is_ready(stream):
            continue
        vec = np.asarray(extractor.compute(stream), dtype=np.float32)
        vec /= max(float(np.linalg.norm(vec)), 1e-8)
        scores = [float(np.dot(vec, c)) for c in centroids]
        index = int(np.argmax(scores)) if scores else 0
        if not scores or scores[index] < .55:
            if len(centroids) < 8:
                index = len(centroids)
                centroids.append(vec)
        else:
            centroids[index] = centroids[index]*.85 + vec*.15
            centroids[index] /= np.linalg.norm(centroids[index])
        s['speaker'] = f'Speaker {index+1}'
    save(args.transcript, transcript)
    cap = cv2.VideoCapture(args.input)
    detector = cv2.FaceDetectorYN.create(str(Path(args.models)/'face.onnx'), '', (640, 360), .75, .3, 5000)
    frames = []
    previous = []
    track_id = 0
    duration = transcript['duration']
    for time in np.arange(0, duration, 1.0):
        cap.set(cv2.CAP_PROP_POS_MSEC, float(time)*1000)
        ok, frame = cap.read()
        if not ok:
            continue
        h, w = frame.shape[:2]
        small = cv2.resize(frame, (640, max(64, round(h*640/w))))
        sh, sw = small.shape[:2]
        detector.setInputSize((sw, sh))
        _, detected = detector.detect(small)
        faces = []
        for raw in detected if detected is not None else []:
            x,y,fw,fh = [float(v) for v in raw[:4]]
            cx = (x+fw/2)/sw
            prior = min(previous, key=lambda p:abs(p['x']+p['w']/2-cx), default=None)
            matched = prior is not None and abs(prior['x']+prior['w']/2-cx)<.12
            if matched:
                tid = prior['track']
            else:
                track_id += 1
                tid = track_id
            # Lower-face appearance change is only weak evidence of speaking.
            roi = small[max(0,int(y+fh*.55)):min(sh,int(y+fh)), max(0,int(x)):min(sw,int(x+fw))]
            patch = cv2.resize(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY), (24,12)) if roi.size else np.zeros((12,24))
            motion = float(np.mean(np.abs(patch.astype(float)-prior['_patch'].astype(float)))/255) if matched else 0
            faces.append({'x':max(0,x/sw),'y':max(0,y/sh),'w':fw/sw,'h':fh/sh,'confidence':float(raw[-1]),'track':tid,'motion':motion,'_patch':patch})
        faces.sort(key=lambda f:f['x'])
        active = max(faces,key=lambda f:f['motion'],default=None)
        ordered = sorted([f['motion'] for f in faces],reverse=True)
        confident = len(faces)==1 or (len(ordered)>1 and ordered[0]>.025 and ordered[0]>ordered[1]*2.2)
        frames.append({'time':float(time),'faces':[{k:v for k,v in f.items() if k!='_patch'} for f in faces], 'activeTrack':active['track'] if active and confident else None,'confidence':.9 if len(faces)==1 else .7 if confident else .25})
        previous=faces
        if int(time)%10==0:
            emit(progress=float(time/duration),message='Tracking speakers and faces')
    cap.release()
    # Associate confident mouth-motion observations with audio speaker labels.
    votes = {}
    for frame in frames:
        segment = next((s for s in transcript['segments'] if s['start'] <= frame['time'] < s['end']), None)
        speaker = segment.get('speaker') if segment else None
        if speaker and frame['confidence'] >= .7 and frame['activeTrack'] is not None:
            counts = votes.setdefault(speaker, {})
            track = frame['activeTrack']
            counts[track] = counts.get(track, 0) + 1
    for frame in frames:
        segment = next((s for s in transcript['segments'] if s['start'] <= frame['time'] < s['end']), None)
        counts = votes.get(segment.get('speaker'), {}) if segment else {}
        visible = {f['track'] for f in frame['faces']}
        available = {track: count for track, count in counts.items() if track in visible}
        if available:
            track = max(available, key=available.get)
            if available[track] >= 3 and available[track] / sum(available.values()) >= .75:
                frame['activeTrack'] = track
                frame['confidence'] = max(frame['confidence'], .75)
    save(args.output, frames)

def setup(args):
    from huggingface_hub import snapshot_download
    target=Path(args.models)/'whisper-small'
    snapshot_download('Systran/faster-whisper-small',local_dir=str(target),allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt','preprocessor_config.json'])
    emit(progress=1,message='Speech model ready')

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['transcribe','frame','setup'])
    for key in ['input','output','models','transcript','audio']:
        parser.add_argument('--'+key)
    parser.add_argument('--gpu', action='store_true')
    args=parser.parse_args()
    try:
        {'transcribe':transcribe,'frame':frame_video,'setup':setup}[args.command](args)
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
