"""JSON-lines worker. Models stay local; stdout contains progress, never credentials."""
import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any, Dict, List

def emit(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)

def save(file, data):
    temp = str(file) + '.tmp'
    Path(temp).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, file)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shared.transcription import run_transcription

def transcribe(args):
    model_path = args.model_path or str(Path(args.models) / 'whisper-small')
    data = run_transcription(
        audio_path=args.input,
        model_path=model_path,
        gpu=args.gpu,
        explicit_language=None,
        emit=emit,
    )
    save(args.output, data)

def frame_video(args):
    import cv2  # type: ignore
    import numpy as np  # type: ignore
    import sherpa_onnx  # type: ignore
    from faster_whisper.audio import decode_audio  # type: ignore
    transcript = json.loads(Path(args.transcript).read_text(encoding='utf-8'))
    audio: Any = decode_audio(args.audio, sampling_rate=16000)
    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(Path(args.models)/'speaker.onnx'), num_threads=2, provider='cpu')
    if not config.validate():
        raise ValueError('Speaker model is missing or invalid. Run setup again.')
    extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
    centroids: List[Any] = []
    for s in transcript['segments']:
        sample: Any = audio[int(s['start']*16000):int(s['end']*16000)]
        if len(sample) < 16000:
            continue
        stream = extractor.create_stream()
        stream.accept_waveform(sample_rate=16000, waveform=sample)
        stream.input_finished()
        if not extractor.is_ready(stream):
            continue
        vec: Any = np.asarray(extractor.compute(stream), dtype=np.float32)
        norm = max(float(np.linalg.norm(vec)), 1e-8)
        vec = vec / norm
        scores = [float(np.dot(vec, c)) for c in centroids]
        index = int(np.argmax(scores)) if scores else 0
        if not scores or scores[index] < .55:
            if len(centroids) < 8:
                index = len(centroids)
                centroids.append(vec)
        else:
            centroids[index] = centroids[index] * 0.85 + vec * 0.15
            c_norm = max(float(np.linalg.norm(centroids[index])), 1e-8)
            centroids[index] = centroids[index] / c_norm
        s['speaker'] = f'Speaker {index+1}'
    speakers_output = getattr(args, 'speakers_output', None)
    if speakers_output:
        save(speakers_output, [s.get('speaker', 'Speaker 1') for s in transcript['segments']])
    else:
        save(args.transcript, transcript)
    cap = cv2.VideoCapture(args.input)
    try:
        detector = cv2.FaceDetectorYN.create(str(Path(args.models)/'face.onnx'), '', (640, 360), .75, .3, 5000)
        frames: List[Dict[str, Any]] = []
        previous: List[Dict[str, Any]] = []
        track_id = 0
        duration = float(transcript.get('duration', 0.0))
        time_steps = [float(t) for t in range(int(duration) + 1)] if duration > 0 else [0.0]
        for time in time_steps:
            if time > duration:
                continue
            cap.set(cv2.CAP_PROP_POS_MSEC, float(time)*1000)
            ok, frame = cap.read()
            if not ok:
                continue
            frame_any: Any = frame
            h, w = frame_any.shape[:2]
            small: Any = cv2.resize(frame, (640, max(64, round(h*640/w))))
            sh, sw = small.shape[:2]
            detector.setInputSize((sw, sh))
            _, detected = detector.detect(small)
            faces: List[Dict[str, Any]] = []
            detected_faces: Any = detected
            for raw in (detected_faces if detected_faces is not None else []):
                raw_face: Any = raw
                x, y, fw, fh = [float(raw_face[i]) for i in range(4)]
                cx = (x + fw / 2) / sw
                prior = min(previous, key=lambda p: abs(p['x'] + p['w'] / 2 - cx), default=None)
                matched = prior is not None and abs(prior['x'] + prior['w'] / 2 - cx) < 0.12
                if matched and prior is not None:
                    tid = prior['track']
                else:
                    track_id += 1
                    tid = track_id
                
                y_start = max(0, int(y + fh * 0.55))
                y_end = min(sh, int(y + fh))
                x_start = max(0, int(x))
                x_end = min(sw, int(x + fw))
                roi: Any = small[y_start:y_end, x_start:x_end]
                if roi.size:
                    gray: Any = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
                    patch: Any = cv2.resize(gray, (24, 12))
                else:
                    patch = np.zeros((12, 24), dtype=np.float32)
                
                if matched and prior is not None:
                    patch_a: Any = patch
                    patch_b: Any = prior['_patch']
                    patch_diff: Any = np.abs(np.subtract(patch_a, patch_b, dtype=np.float32))
                    motion = float(np.mean(patch_diff) / 255.0)
                else:
                    motion = 0.0

                faces.append({
                    'x': max(0.0, x / sw),
                    'y': max(0.0, y / sh),
                    'w': fw / sw,
                    'h': fh / sh,
                    'confidence': float(raw_face[-1]),
                    'track': tid,
                    'motion': motion,
                    '_patch': patch
                })
            faces.sort(key=lambda f: f['x'])
            active = max(faces, key=lambda f: f['motion'], default=None)
            ordered = sorted([f['motion'] for f in faces], reverse=True)
            confident = len(faces) == 1 or (len(ordered) > 1 and ordered[0] > 0.025 and ordered[0] > ordered[1] * 2.2)
            frames.append({
                'time': float(time),
                'faces': [{k: v for k, v in f.items() if k != '_patch'} for f in faces],
                'activeTrack': active['track'] if active and confident else None,
                'confidence': 0.9 if len(faces) == 1 else 0.7 if confident else 0.25
            })
            previous = faces
            if int(time) % 10 == 0 and duration > 0:
                emit(progress=float(time / duration), message='Tracking speakers and faces')
    finally:
        cap.release()
    # Associate confident mouth-motion observations with audio speaker labels.
    votes: Dict[str, Dict[int, int]] = {}
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
            track = max(available, key=lambda t: available[t])
            if available[track] >= 3 and available[track] / sum(available.values()) >= .75:
                frame['activeTrack'] = track
                frame['confidence'] = max(frame['confidence'], .75)
    save(args.output, frames)

def setup(args):
    from huggingface_hub import snapshot_download  # type: ignore
    target=Path(args.models)/'whisper-small'
    snapshot_download('Systran/faster-whisper-small',local_dir=str(target),allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt','preprocessor_config.json'])
    emit(progress=1,message='Speech model ready')

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['transcribe','frame','setup'])
    for key in ['input','output','models','transcript','audio','model-path','speakers-output']:
        parser.add_argument('--'+key)
    parser.add_argument('--gpu', action='store_true')
    args=parser.parse_args()
    try:
        {'transcribe':transcribe,'frame':frame_video,'setup':setup}[args.command](args)
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
