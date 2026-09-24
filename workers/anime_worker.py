# pyright: reportGeneralTypeIssues=false
# pyright: reportArgumentType=false
# pyright: reportCallIssue=false
# pyright: reportOperatorIssue=false
# pyright: reportIndexIssue=false
# pyright: reportAttributeAccessIssue=false
# pyright: reportOptionalMemberAccess=false
# pyright: reportUnnecessaryCast=false
"""Anime Studio worker.
Handles shot detection (PySceneDetect), music rhythm mapping (Librosa),
and Japanese/English speech transcription via shared faster-whisper.
"""
import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Tuple, Set

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
    import scenedetect  # type: ignore
    from scenedetect import open_video, SceneManager, ContentDetector  # type: ignore

    emit(progress=0.05, message='Detecting anime scene and shot boundaries')
    video = open_video(args.input)
    scene_manager = SceneManager()
    scene_manager.auto_downscale = True
    # ContentDetector threshold: 27 is standard for anime cuts without over-triggering on fast action
    scene_manager.add_detector(ContentDetector(threshold=27.0, min_scene_len=12))

    total_frames = video.duration.frame_num if video.duration else 0

    def progress_callback(image, frame_num):
        idx = frame_num.frame_num if hasattr(frame_num, 'frame_num') else int(frame_num)
        if total_frames > 0 and idx % 150 == 0:
            pct = min(0.95, idx / total_frames)
            emit(progress=pct, message=f'Scanning frames for cuts · {int(pct * 100)}%')

    scene_manager.detect_scenes(video=video, callback=progress_callback, frame_skip=1)
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
    import numpy as np  # type: ignore
    import librosa  # type: ignore

    np_any: Any = np
    librosa_any: Any = librosa

    emit(progress=0.1, message='Loading music track for rhythm analysis')
    # Load music at 22050Hz for efficient feature extraction
    y, sr = librosa_any.load(args.input, sr=22050, mono=True)
    duration = float(librosa_any.get_duration(y=y, sr=sr))

    emit(progress=0.3, message='Extracting BPM and beat grid')
    tempo, beat_frames = librosa_any.beat.beat_track(y=y, sr=sr)
    # Ensure tempo is float (librosa 1.0 compatibility)
    tempo_val = round(float(np_any.atleast_1d(tempo)[0]), 1)
    beat_times = [round(float(t), 3) for t in librosa_any.frames_to_time(beat_frames, sr=sr)]

    emit(progress=0.6, message='Analyzing onset strengths and dynamics')
    onset_env = librosa_any.onset.onset_strength(y=y, sr=sr)
    onset_frames = librosa_any.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    onset_times = [round(float(t), 3) for t in librosa_any.frames_to_time(onset_frames, sr=sr)]

    # Compute RMS energy sections across ~2-second windows
    hop_length = 512
    frame_length = 2048
    rms_feature = librosa_any.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)
    rms = np_any.asarray(rms_feature)[0] if np_any.ndim(rms_feature) > 1 else np_any.asarray(rms_feature)
    rms_times = np_any.asarray(librosa_any.frames_to_time(np_any.arange(len(rms)), sr=sr, hop_length=hop_length))

    # Downsample energy into 2-second buckets
    energy_sections = []
    bucket_sec = 2.0
    for t_start in [float(x) for x in np_any.arange(0, duration, bucket_sec)]:
        t_end = min(duration, t_start + bucket_sec)
        mask = (rms_times >= t_start) & (rms_times < t_end)
        mean_energy = float(np_any.mean(rms[mask])) if np_any.any(mask) else 0.0
        energy_sections.append({
            'start': round(float(t_start), 2),
            'end': round(float(t_end), 2),
            'energy': round(mean_energy, 4)
        })

    # Identify strong beats: beat times with high onset strength (>= 65th percentile)
    strong_beats = []
    beat_frames_list = [int(f) for f in beat_frames] if hasattr(beat_frames, '__iter__') else []
    if len(beat_frames_list) > 0 and len(onset_env) > 0:
        valid_frames = [f for f in beat_frames_list if f < len(onset_env)]
        if valid_frames:
            beat_strengths = np_any.array([float(onset_env[f]) for f in valid_frames])
            thresh = float(np_any.percentile(beat_strengths, 65)) if len(beat_strengths) > 1 else 0.0
            for idx, f in enumerate(valid_frames):
                if float(onset_env[f]) >= thresh and idx < len(beat_times):
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

def get_face_detector(models_dir=None):
    """Retrieve anime face detector if available, otherwise fallback to OpenCV YuNet."""
    try:
        import importlib
        anime_face_detector = importlib.import_module('anime_face_detector')
        detector = anime_face_detector.create_detector('yolov3')
        return ('anime_face_detector', detector)
    except Exception:
        pass
    if models_dir:
        import cv2  # type: ignore
        cv2_any: Any = cv2
        model_path = Path(models_dir) / 'face.onnx'
        if model_path.exists():
            try:
                detector = cv2_any.FaceDetectorYN.create(str(model_path), '', (320, 180), 0.35, 0.3, 10)
                return ('yunet', detector)
            except Exception:
                pass
    return (None, None)

def analyze_motion_and_faces(source_path, shots, models_dir=None, emit=None):
    """Scan shots with OpenCV: frame differencing, motion delta, brightness, sharpness, and anime face detection."""
    import cv2  # type: ignore
    import numpy as np  # type: ignore

    cv2_any: Any = cv2
    np_any: Any = np

    cap = cv2_any.VideoCapture(source_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {source_path}")
    try:
        fps = cap.get(cv2_any.CAP_PROP_FPS) or 24.0
        total_frames = int(cap.get(cv2_any.CAP_PROP_FRAME_COUNT) or 0)
        target_w, target_h = 320, 180

        det_type, detector = get_face_detector(models_dir)
        if det_type == 'yunet' and detector is not None:
            detector.setInputSize((target_w, target_h))

        results = []
        num_shots = len(shots)
        sample_interval_sec = 0.25
        sample_step_frames = max(1, int(fps * sample_interval_sec))

        for shot_idx, shot in enumerate(shots):
            start_sec = shot['start']
            end_sec = shot['end']
            dur = shot['duration']

            start_f = max(0, int(start_sec * fps))
            end_f = min(total_frames, int(end_sec * fps)) if total_frames > 0 else int(end_sec * fps)

            prev_gray = None
            motion_samples = []
            sharpness_samples = []
            brightness_samples = []

            if end_f <= start_f:
                frame_indices = [start_f]
            else:
                frame_indices = list(range(start_f, end_f, sample_step_frames))
                if not frame_indices:
                    frame_indices = [start_f]
                if len(frame_indices) > 20:
                    np_any: Any = np
                    indices_step = [round(float(i)) for i in np_any.linspace(0, len(frame_indices) - 1, 20)]
                    frame_indices = [frame_indices[i] for i in indices_step]

            best_face_ratio = 0.0
            best_face_conf = 0.0
            face_count = 0

            face_check_frames = set()
            if len(frame_indices) >= 2:
                face_check_frames.add(frame_indices[len(frame_indices) // 3])
                face_check_frames.add(frame_indices[(len(frame_indices) * 2) // 3])
            elif frame_indices:
                face_check_frames.add(frame_indices[0])

            for f_idx in frame_indices:
                cap.set(cv2_any.CAP_PROP_POS_FRAMES, f_idx)
                ret, frame = cap.read()
                if not ret or frame is None:
                    continue

                small = cv2_any.resize(frame, (target_w, target_h), interpolation=cv2_any.INTER_AREA)
                gray = cv2_any.cvtColor(small, cv2_any.COLOR_BGR2GRAY)

                lap = cv2_any.Laplacian(gray, cv2_any.CV_64F)
                sharpness = float(lap.var())
                sharpness_samples.append(sharpness)
                brightness_samples.append(float(np_any.mean(gray) / 255.0))

                t_sec = f_idx / fps
                if prev_gray is not None:
                    diff = cv2_any.absdiff(gray, prev_gray)
                    mean_diff = float(np_any.mean(diff) / 255.0)
                    std_diff = float(np_any.std(diff) / 255.0)
                    motion_val = float(mean_diff + 0.5 * std_diff)
                    motion_samples.append((t_sec, motion_val))
                prev_gray = gray

                if f_idx in face_check_frames and detector is not None:
                    try:
                        if det_type == 'anime_face_detector':
                            det_callable: Any = detector
                            preds = det_callable(small)
                            if preds and len(preds) > 0:
                                face_count = max(face_count, len(preds))
                                for p in preds:
                                    bbox = p.get('bbox', [0, 0, 0, 0, 0])
                                    w = max(0, bbox[2] - bbox[0])
                                    h = max(0, bbox[3] - bbox[1])
                                    ratio = (w * h) / (target_w * target_h)
                                    best_face_ratio = max(best_face_ratio, float(ratio))
                                    best_face_conf = max(best_face_conf, float(bbox[4] if len(bbox) > 4 else 0.8))
                        elif det_type == 'yunet':
                            det_any: Any = detector
                            res = det_any.detect(small)
                            if res[1] is not None and len(res[1]) > 0:
                                detected_faces: Any = res[1]
                                face_count = max(face_count, len(detected_faces))
                                for f_face in detected_faces:
                                    raw_f: Any = f_face
                                    w, h, conf = raw_f[2], raw_f[3], raw_f[14]
                                    ratio = (float(w) * float(h)) / (target_w * target_h)
                                    best_face_ratio = max(best_face_ratio, float(ratio))
                                    best_face_conf = max(best_face_conf, float(conf))
                    except Exception:
                        pass

            if motion_samples:
                peak_sample = max(motion_samples, key=lambda x: x[1])
                motion_peak_time = round(peak_sample[0], 3)
                motion_peak = round(peak_sample[1], 4)
                motion_avg = round(float(sum(m[1] for m in motion_samples) / len(motion_samples)), 4)
            else:
                motion_peak_time = round(start_sec + dur * 0.4, 3)
                motion_peak = 0.0
                motion_avg = 0.0

            sharpness_avg = round(float(sum(sharpness_samples) / len(sharpness_samples)), 2) if sharpness_samples else 0.0
            brightness_avg = round(float(sum(brightness_samples) / len(brightness_samples)), 4) if brightness_samples else 0.5
            face_score = round(min(1.0, best_face_ratio * 4.0 * 0.6 + best_face_conf * 0.4), 4) if face_count > 0 else 0.0

            results.append({
                'shot_id': shot['id'],
                'motion_peak': motion_peak,
                'motion_peak_time': motion_peak_time,
                'motion_avg': motion_avg,
                'sharpness_avg': sharpness_avg,
                'brightness_avg': brightness_avg,
                'face_count': face_count,
                'face_score': face_score,
                'max_face_ratio': round(best_face_ratio, 4)
            })

            if emit and (shot_idx % 10 == 0 or shot_idx == num_shots - 1):
                pct = 0.05 + 0.50 * ((shot_idx + 1) / num_shots)
                emit(progress=round(pct, 2), message=f'Analyzing motion and character faces · Shot {shot_idx + 1}/{num_shots}')

    finally:
        cap.release()
        try:
            import torch  # type: ignore
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
    return results

def analyze_audio_signals(audio_path, shots):
    """Compute RMS energy and onset transient spikes across audio for each shot."""
    import soundfile as sf  # type: ignore
    import numpy as np  # type: ignore

    sf_any: Any = sf
    np_any: Any = np

    data_raw, sr = sf_any.read(audio_path, dtype='float32')
    data = np_any.asarray(data_raw, dtype=np_any.float32)
    if data.ndim > 1:
        data = np_any.mean(data, axis=1)

    hop = int(sr * 0.05)
    if hop <= 0:
        hop = 1024

    num_frames = len(data) // hop
    if num_frames == 0:
        return [{'shot_id': s['id'], 'rms_mean': 0.0, 'rms_peak': 0.0, 'transient_peak': 0.0, 'transient_time': round(s['start'] + s['duration'] * 0.4, 3)} for s in shots]

    rms_list = []
    for i in range(num_frames):
        chunk = data[i * hop : (i + 1) * hop]
        val = float(np_any.sqrt(np_any.mean(chunk ** 2))) if len(chunk) > 0 else 0.0
        rms_list.append(val)
    rms = np_any.array(rms_list, dtype=np_any.float32)

    diff_rms = np_any.diff(rms, prepend=float(rms[0]) if len(rms) > 0 else 0.0)
    transients = np_any.maximum(0.0, diff_rms)

    p98_rms = float(np_any.percentile(rms, 98)) if len(rms) > 0 else 1.0
    p98_trans = float(np_any.percentile(transients, 98)) if len(transients) > 0 else 1.0
    max_rms = p98_rms if p98_rms > 1e-4 else 1.0
    max_trans = p98_trans if p98_trans > 1e-4 else 1.0

    norm_rms = np_any.clip(rms / max_rms, 0.0, 1.0)
    norm_trans = np_any.clip(transients / max_trans, 0.0, 1.0)

    shot_signals = []
    for shot in shots:
        start_frame = int((shot['start'] * sr) / hop)
        end_frame = int((shot['end'] * sr) / hop)
        if start_frame >= len(norm_rms):
            start_frame = max(0, len(norm_rms) - 1)
        if end_frame <= start_frame:
            end_frame = min(len(norm_rms), start_frame + 1)

        shot_rms = norm_rms[start_frame:end_frame]
        shot_trans = norm_trans[start_frame:end_frame]

        rms_mean = float(np_any.mean(shot_rms)) if len(shot_rms) > 0 else 0.0
        rms_peak = float(np_any.max(shot_rms)) if len(shot_rms) > 0 else 0.0

        if len(shot_trans) > 0:
            peak_idx = int(np_any.argmax(shot_trans))
            trans_peak = float(shot_trans[peak_idx])
            trans_time = round(shot['start'] + (peak_idx * hop) / sr, 3)
        else:
            trans_peak = 0.0
            trans_time = round(shot['start'] + shot['duration'] * 0.4, 3)

        shot_signals.append({
            'shot_id': shot['id'],
            'rms_mean': round(rms_mean, 4),
            'rms_peak': round(rms_peak, 4),
            'transient_peak': round(trans_peak, 4),
            'transient_time': trans_time
        })
    return shot_signals

def score_candidates(args):
    """Local Intelligence: OpenCV motion, anime face detection, audio energy/transient analysis,
    multi-signal impact scoring, and candidate diversity ranking (~250 shots -> ~20-30 candidate moments).
    """
    source_path = args.source or args.input
    shots_path = args.shots
    audio_path = args.audio
    transcript_path = args.transcript
    models_dir = args.models
    output_path = args.output

    if not shots_path or not Path(shots_path).exists():
        emit(progress=1.0, message="No shots file provided for candidate scoring")
        save(output_path, [])
        return

    shots = json.loads(Path(shots_path).read_text(encoding='utf-8'))
    if not shots:
        emit(progress=1.0, message="Empty shots list; zero candidates found")
        save(output_path, [])
        return

    emit(progress=0.05, message=f"Starting local visual and motion analysis across {len(shots)} shots")
    motion_and_faces = analyze_motion_and_faces(source_path, shots, models_dir=models_dir, emit=emit)

    emit(progress=0.60, message="Analyzing audio energy and transient spikes")
    audio_signals = analyze_audio_signals(audio_path, shots) if audio_path and Path(audio_path).exists() else []

    audio_by_id = {a['shot_id']: a for a in audio_signals}
    motion_by_id = {m['shot_id']: m for m in motion_and_faces}

    dialogue_by_shot = {}
    if transcript_path and Path(transcript_path).exists():
        try:
            transcript_data = json.loads(Path(transcript_path).read_text(encoding='utf-8'))
            segments = transcript_data.get('segments', [])
            for shot in shots:
                s_start = shot['start']
                s_end = shot['end']
                matching_texts = []
                for seg in segments:
                    if seg.get('start', 0) < s_end and seg.get('end', 0) > s_start:
                        text = seg.get('text', '').strip()
                        if text:
                            matching_texts.append(text)
                dialogue_by_shot[shot['id']] = ' '.join(matching_texts)
        except Exception:
            pass

    emit(progress=0.75, message="Computing multi-signal impact scores and finding peak impact frames")

    if getattr(args, 'motion_output', None):
        save(args.motion_output, motion_and_faces)
    if getattr(args, 'audio_output', None):
        save(args.audio_output, audio_signals)

    scored_candidates = []
    for shot in shots:
        s_id = shot['id']
        start_sec = shot['start']
        end_sec = shot['end']
        duration = shot['duration']

        if duration < 0.6:
            continue

        m_data = motion_by_id.get(s_id, {})
        a_data = audio_by_id.get(s_id, {})

        motion_peak = m_data.get('motion_peak', 0.0)
        motion_peak_time = m_data.get('motion_peak_time', round(start_sec + duration * 0.4, 3))
        motion_avg = m_data.get('motion_avg', 0.0)
        sharpness_avg = m_data.get('sharpness_avg', 0.0)
        brightness_avg = m_data.get('brightness_avg', 0.5)
        face_count = m_data.get('face_count', 0)
        face_score = m_data.get('face_score', 0.0)
        max_face_ratio = m_data.get('max_face_ratio', 0.0)

        if brightness_avg < 0.03:
            continue

        rms_mean = a_data.get('rms_mean', 0.0)
        rms_peak = a_data.get('rms_peak', 0.0)
        transient_peak = a_data.get('transient_peak', 0.0)
        transient_time = a_data.get('transient_time', round(start_sec + duration * 0.4, 3))

        dialogue_text = dialogue_by_shot.get(s_id, '')
        has_dialogue = len(dialogue_text) > 0

        norm_motion_spike = min(1.0, motion_peak / 0.30) if motion_peak else 0.0
        norm_transient = min(1.0, transient_peak / 0.35) if transient_peak else 0.0
        norm_frame_diff = min(1.0, motion_avg / 0.12) if motion_avg else 0.0
        norm_face = min(1.0, face_score)
        norm_audio_energy = min(1.0, rms_peak / 0.45) if rms_peak else 0.0

        impact_score = round(
            0.35 * norm_motion_spike +
            0.25 * norm_transient +
            0.20 * norm_frame_diff +
            0.15 * norm_face +
            0.05 * norm_audio_energy,
            4
        )

        if norm_motion_spike + norm_transient > 0.01:
            impact_time = round(
                (norm_motion_spike * motion_peak_time + norm_transient * transient_time) / (norm_motion_spike + norm_transient),
                3
            )
        else:
            impact_time = round(start_sec + duration * 0.4, 3)

        impact_time = max(start_sec, min(end_sec, impact_time))

        # For long shots (> 10.0s), center a 4.5s edit window around the impact moment
        if duration > 10.0:
            c_start = max(start_sec, round(impact_time - 2.0, 3))
            c_end = min(end_sec, round(c_start + 4.5, 3))
            c_dur = round(c_end - c_start, 3)
        else:
            c_start = start_sec
            c_end = end_sec
            c_dur = duration

        if norm_motion_spike >= 0.45 and norm_transient >= 0.35:
            category = 'action'
            cat_bonus = 0.25 * norm_motion_spike + 0.15 * norm_transient
        elif norm_face >= 0.30 and (has_dialogue or norm_motion_spike < 0.40):
            category = 'emotional'
            cat_bonus = 0.30 * norm_face + (0.10 if has_dialogue else 0.0)
        elif has_dialogue:
            category = 'dialogue'
            cat_bonus = 0.20 + 0.10 * norm_audio_energy
        else:
            category = 'cinematic'
            norm_sharpness = min(1.0, sharpness_avg / 250.0) if sharpness_avg else 0.0
            cat_bonus = 0.20 * norm_sharpness + 0.10 * (1.0 - norm_motion_spike)

        total_score = round(0.65 * impact_score + 0.35 * cat_bonus, 4)

        scored_candidates.append({
            'shotId': s_id,
            'start': round(c_start, 3),
            'end': round(c_end, 3),
            'duration': round(c_dur, 3),
            'impactTime': round(impact_time, 3),
            'motionScore': round(norm_motion_spike, 4),
            'faceScore': round(norm_face, 4),
            'audioEnergyScore': round(norm_audio_energy, 4),
            'transientScore': round(norm_transient, 4),
            'impactScore': round(impact_score, 4),
            'totalScore': round(total_score, 4),
            'category': category,
            'hasDialogue': has_dialogue,
            'dialogueText': dialogue_text[:120] if dialogue_text else '',
            'facesCount': face_count,
            'maxFaceRatio': round(max_face_ratio, 4),
            'motionPeak': round(motion_peak, 4),
            'transientPeak': round(transient_peak, 4)
        })

    emit(progress=0.90, message=f"Ranking and diversity filtering across {len(scored_candidates)} candidates")

    scored_candidates.sort(key=lambda c: c['totalScore'], reverse=True)

    selected = []
    seen_intervals = []

    for cand in scored_candidates:
        cand_start = cand['start']
        cand_end = cand['end']
        cand_cat = cand['category']

        suppressed = False
        for (s_start, s_end, s_cat) in seen_intervals:
            if abs(cand_start - s_start) < 2.0 or (cand_start < s_end and cand_end > s_start):
                if cand_cat == s_cat or len(selected) >= 20:
                    suppressed = True
                    break

        if not suppressed or len(selected) < 15:
            selected.append(cand)
            seen_intervals.append((cand_start, cand_end, cand_cat))

        if len(selected) >= 30:
            break

    if len(selected) < 20 and len(scored_candidates) > len(selected):
        selected_ids = {c['shotId'] for c in selected}
        for cand in scored_candidates:
            if cand['shotId'] not in selected_ids:
                selected.append(cand)
                selected_ids.add(cand['shotId'])
            if len(selected) >= 25:
                break

    for rank, cand in enumerate(selected):
        cand['id'] = rank + 1

    emit(progress=1.0, message=f"Discovered {len(selected)} ranked candidate moments")
    save(output_path, selected)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Anime Studio Worker')
    parser.add_argument('command', choices=['detect-scenes', 'analyze-music', 'transcribe', 'score-candidates'])
    for key in ['input', 'source', 'shots', 'audio', 'transcript', 'output', 'models', 'model-path', 'language', 'motion-output', 'audio-output']:
        parser.add_argument('--' + key)
    parser.add_argument('--gpu', action='store_true')
    args = parser.parse_args()

    try:
        commands = {
            'detect-scenes': detect_scenes,
            'analyze-music': analyze_music,
            'transcribe': transcribe,
            'score-candidates': score_candidates,
        }
        commands[args.command](args)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
