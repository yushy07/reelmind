"""Anime Studio worker.
Handles shot detection (PySceneDetect), music rhythm mapping (Librosa),
and Japanese/English speech transcription via shared faster-whisper.
"""
import argparse
import json
import os
from pathlib import Path
import sys

# Ensure workers directory is on path to import shared modules
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shared.transcription import run_transcription

def emit(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)

def save(file, data):
    temp = str(file) + '.tmp'
    Path(temp).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, file)

def detect_scenes(args):
    """Decompose an anime episode into scenes and shots using PySceneDetect."""
    import scenedetect
    from scenedetect import open_video, SceneManager, ContentDetector

    emit(progress=0.05, message='Detecting anime scene and shot boundaries')
    video = open_video(args.input)
    scene_manager = SceneManager()
    # ContentDetector threshold: 27 is standard for anime cuts without over-triggering on fast action
    scene_manager.add_detector(ContentDetector(threshold=27.0, min_scene_len=15))

    total_frames = video.duration.frame_num if video.duration else 0

    def progress_callback(image, frame_num):
        idx = frame_num.frame_num if hasattr(frame_num, 'frame_num') else int(frame_num)
        if total_frames > 0 and idx % 150 == 0:
            pct = min(0.95, idx / total_frames)
            emit(progress=pct, message=f'Scanning frames for cuts · {int(pct * 100)}%')

    scene_manager.detect_scenes(video=video, callback=progress_callback)
    scenes = scene_manager.get_scene_list()

    shots = []
    for i, (start_time, end_time) in enumerate(scenes):
        start_sec = round(float(start_time.seconds if hasattr(start_time, 'seconds') else start_time.get_seconds()), 3)
        end_sec = round(float(end_time.seconds if hasattr(end_time, 'seconds') else end_time.get_seconds()), 3)
        dur = round(end_sec - start_sec, 3)
        keyframe = round(start_sec + dur * 0.4, 3)
        shots.append({
            'id': i + 1,
            'start': start_sec,
            'end': end_sec,
            'duration': dur,
            'keyframe_time': keyframe
        })

    # Fallback if no scenes were detected (e.g. single static scene or short clip)
    if not shots:
        dur = float(video.duration.seconds if hasattr(video.duration, 'seconds') else video.duration.get_seconds()) if video.duration else 0.0
        shots.append({
            'id': 1,
            'start': 0.0,
            'end': round(dur, 3),
            'duration': round(dur, 3),
            'keyframe_time': round(dur / 2.0, 3)
        })

    emit(progress=1.0, message=f'Detected {len(shots)} shots across episode')
    save(args.output, shots)

def analyze_music(args):
    """Analyze music audio using Librosa: BPM, beats, onsets, and energy curve."""
    import numpy as np
    import librosa

    emit(progress=0.1, message='Loading music track for rhythm analysis')
    # Load music at 22050Hz for efficient feature extraction
    y, sr = librosa.load(args.input, sr=22050, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    emit(progress=0.3, message='Extracting BPM and beat grid')
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    # Ensure tempo is float (librosa 1.0 compatibility)
    tempo_val = round(float(np.atleast_1d(tempo)[0]), 1)
    beat_times = [round(float(t), 3) for t in librosa.frames_to_time(beat_frames, sr=sr)]

    emit(progress=0.6, message='Analyzing onset strengths and dynamics')
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    onset_times = [round(float(t), 3) for t in librosa.frames_to_time(onset_frames, sr=sr)]

    # Compute RMS energy sections across ~2-second windows
    hop_length = 512
    frame_length = 2048
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)

    # Downsample energy into 2-second buckets
    energy_sections = []
    bucket_sec = 2.0
    for t_start in np.arange(0, duration, bucket_sec):
        t_end = min(duration, t_start + bucket_sec)
        mask = (rms_times >= t_start) & (rms_times < t_end)
        mean_energy = float(np.mean(rms[mask])) if np.any(mask) else 0.0
        energy_sections.append({
            'start': round(float(t_start), 2),
            'end': round(float(t_end), 2),
            'energy': round(mean_energy, 4)
        })

    # Identify strong beats: beat times with high onset strength (>= 65th percentile)
    strong_beats = []
    if len(beat_frames) > 0 and len(onset_env) > 0:
        valid_frames = [f for f in beat_frames if f < len(onset_env)]
        if valid_frames:
            beat_strengths = onset_env[valid_frames]
            thresh = np.percentile(beat_strengths, 65) if len(beat_strengths) > 1 else 0.0
            for idx, f in enumerate(valid_frames):
                if onset_env[f] >= thresh:
                    strong_beats.append(beat_times[idx])

    result = {
        'duration': round(duration, 3),
        'bpm': tempo_val,
        'beats': beat_times,
        'strong_beats': strong_beats,
        'energy_sections': energy_sections,
        'onset_times': onset_times[:500]  # Cap to first 500 for compact JSON
    }

    emit(progress=1.0, message=f'Music mapped · {tempo_val} BPM with {len(beat_times)} beats')
    save(args.output, result)

def transcribe(args):
    """Transcribe dialogue using shared faster-whisper with explicit language."""
    model_path = args.model_path or str(Path(args.models) / 'whisper-small')
    lang = getattr(args, 'language', None)
    if lang not in ['ja', 'en']:
        lang = None

    emit(progress=0.05, message=f'Transcribing anime dialogue · {args.language or "auto"}')
    data = run_transcription(
        audio_path=args.input,
        model_path=model_path,
        gpu=args.gpu,
        explicit_language=lang,
        emit=emit,
    )
    save(args.output, data)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Anime Studio Worker')
    parser.add_argument('command', choices=['detect-scenes', 'analyze-music', 'transcribe'])
    for key in ['input', 'output', 'models', 'model-path', 'language']:
        parser.add_argument('--' + key)
    parser.add_argument('--gpu', action='store_true')
    args = parser.parse_args()

    try:
        commands = {
            'detect-scenes': detect_scenes,
            'analyze-music': analyze_music,
            'transcribe': transcribe,
        }
        commands[args.command](args)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
