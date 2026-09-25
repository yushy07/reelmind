"""ReelMind Music Intelligence Service.
Local-first, offline-capable music structural analysis and adaptive music segmentation.
Fuses multi-signal MIR principles inspired by:
  - All-In-One-Infer (openmirlab): functional section segmentation, downbeats & beat hierarchy,
    structural novelty detection, GPU/CPU adaptive execution.
  - MSAF (urinieto/msaf, MIT license): structural boundary cross-checks, Foote checkerboard
    self-similarity matrix (SSM) kernel convolution, section classification.
  - Librosa: spectral features, chroma CQT/STFT, onset envelopes, and energy profiles.
"""

import math
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import numpy as np

# Ensure shared GPU initialization is available
try:
    from shared.gpu import setup_cuda_environment
    setup_cuda_environment()
except Exception:
    pass


def foote_novelty(chroma: np.ndarray, mfcc: np.ndarray, kernel_size: int = 16) -> np.ndarray:
    """Computes a structural novelty curve using Foote's checkerboard kernel over

    combined chroma (harmonic) and MFCC (timbral) self-similarity matrices.
    Reference: MSAF structural segmentation & Foote (2000).
    """
    n_frames = chroma.shape[1]
    if n_frames < kernel_size:
        return np.zeros(n_frames, dtype=np.float32)

    # Normalize feature vectors across time
    eps = 1e-8
    chroma_norm = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + eps)
    mfcc_norm = mfcc / (np.linalg.norm(mfcc, axis=0, keepdims=True) + eps)

    # Combined self-similarity matrix
    ssm_chroma = np.dot(chroma_norm.T, chroma_norm)
    ssm_mfcc = np.dot(mfcc_norm.T, mfcc_norm)
    ssm = 0.5 * (ssm_chroma + ssm_mfcc)

    # Construct Foote checkerboard kernel with Gaussian taper
    half = kernel_size // 2
    kernel = np.zeros((kernel_size, kernel_size), dtype=np.float32)
    kernel[:half, :half] = 1.0
    kernel[half:, half:] = 1.0
    kernel[:half, half:] = -1.0
    kernel[half:, :half] = -1.0

    t = np.linspace(-2.0, 2.0, kernel_size, dtype=np.float32)
    gaussian_1d = np.exp(-t**2)
    taper = np.outer(gaussian_1d, gaussian_1d)
    kernel = kernel * taper

    # Fast 1D diagonal extraction correlation
    novelty = np.zeros(n_frames, dtype=np.float32)
    for i in range(half, n_frames - half):
        sub_ssm = ssm[i - half : i + half, i - half : i + half]
        novelty[i] = float(np.sum(sub_ssm * kernel))

    # Half-wave rectification and normalization
    novelty = np.maximum(0.0, novelty)
    max_val = float(np.max(novelty)) if np.max(novelty) > eps else 1.0
    return novelty / max_val


def detect_downbeats(beat_times: List[float], y: np.ndarray, sr: int, bpm: float) -> List[float]:
    """Infers downbeat timestamps (bar heads, typically 4/4 or 3/4 meter)

    by evaluating spectral flux, low-frequency bass impact, and onset energy at beat positions.
    Inspired by All-In-One-Infer / madmom beat-downbeat tracking models.
    """
    if len(beat_times) < 4:
        return beat_times[:]

    import librosa

    # Compute onset strength and sub-bass energy (frequencies <= 160Hz)
    hop_length = 512
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    
    # Filter for low-frequency kick/bass energy
    stft = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    bass_mask = freqs <= 160.0
    bass_energy = np.mean(stft[bass_mask, :], axis=0) if np.any(bass_mask) else onset_env

    # Measure beat saliency
    beat_frames = librosa.time_to_frames(np.array(beat_times), sr=sr, hop_length=hop_length)
    saliency = []
    for f in beat_frames:
        if f < len(onset_env) and f < len(bass_energy):
            sal = float(0.6 * onset_env[f] + 0.4 * (bass_energy[f] / (np.max(bass_energy) + 1e-6)))
            saliency.append(sal)
        else:
            saliency.append(0.0)

    # Test 4-beat bar alignments (4/4 time signature dominant in modern/anime soundtracks)
    best_phase = 0
    best_phase_score = -1.0
    for phase in range(min(4, len(saliency))):
        phase_scores = [saliency[i] for i in range(phase, len(saliency), 4)]
        avg_score = float(np.mean(phase_scores)) if phase_scores else 0.0
        if avg_score > best_phase_score:
            best_phase_score = avg_score
            best_phase = phase

    downbeats = [beat_times[i] for i in range(best_phase, len(beat_times), 4)]
    return downbeats


def classify_section_label(
    start: float,
    end: float,
    total_duration: float,
    mean_energy: float,
    peak_energy: float,
    onset_density: float,
    prev_energy: Optional[float],
    next_energy: Optional[float]
) -> Tuple[str, float]:
    """Deterministically classifies structural sections into functional labels

    (intro, verse, chorus, drop, break, bridge, outro, climax, ambient)
    based on temporal position, relative dynamics, onset density, and trajectory.
    Conforms to MIR functional segment taxonomy (All-In-One-Infer & MSAF).
    """
    dur = end - start
    pos = (start + end) / (2.0 * max(1.0, total_duration))

    # 1. Positional intros and outros
    if start < 12.0 and pos < 0.15 and mean_energy < 0.65:
        return ('intro', 0.90)
    if end >= total_duration - 12.0 and pos > 0.85 and mean_energy < 0.60:
        return ('outro', 0.88)

    # 2. Climax / High-intensity drops
    if peak_energy > 0.82 and onset_density > 0.65:
        if prev_energy is not None and (mean_energy - prev_energy) > 0.25:
            return ('drop', 0.92)
        if pos > 0.60:
            return ('climax', 0.89)
        return ('chorus', 0.85)

    # 3. Builds and high energy choruses
    if mean_energy >= 0.62 and onset_density >= 0.50:
        if prev_energy is not None and (mean_energy - prev_energy) > 0.18:
            return ('drop', 0.84)
        return ('chorus', 0.88)

    # 4. Breaks and bridges (calm / interlude moments)
    if mean_energy < 0.35 and onset_density < 0.35:
        if 0.25 <= pos <= 0.80:
            return ('break', 0.86)
        return ('ambient', 0.80)

    if 0.45 <= pos <= 0.75 and (prev_energy or 0.5) > mean_energy:
        return ('bridge', 0.82)

    # 5. Default rhythmic verse
    if mean_energy < 0.55:
        return ('verse', 0.80)

    return ('chorus', 0.75)


def generate_candidate_regions(
    sections: List[Dict[str, Any]],
    beats: List[float],
    downbeats: List[float],
    duration: float,
    min_dur: float = 24.0,
    max_dur: float = 38.0
) -> List[Dict[str, Any]]:
    """Generates beat and downbeat-snapped candidate music regions across the song.

    Ensures musical phrase completeness, avoids awkward mid-beat truncations,
    and supports multi-clip AMV matching with distinct music passages.
    """
    regions: List[Dict[str, Any]] = []
    beat_arr = np.array(beats) if beats else np.array([])
    downbeat_arr = np.array(downbeats) if downbeats else np.array([])

    def find_nearest(arr: np.ndarray, target: float, max_dist: float = 1.0) -> Optional[float]:
        if len(arr) == 0:
            return None
        idx = int(np.argmin(np.abs(arr - target)))
        val = float(arr[idx])
        if abs(val - target) <= max_dist:
            return val
        return None

    region_idx = 1
    # 1. Primary regions originating around downbeats in each structural section
    for sec in sections:
        sec_start = sec['start']
        sec_end = sec['end']
        sec_label = sec['label']

        # Candidate start anchors: section downbeats, or section start
        sec_downbeats = [d for d in downbeats if sec_start - 0.2 <= d < sec_end - min_dur + 5.0]
        if not sec_downbeats:
            sec_downbeats = [sec_start]

        # Take up to 3 distinct start points within the section
        chosen_starts = sec_downbeats[:3]
        for start_t in chosen_starts:
            for target_dur in [26.0, 29.0, 32.0]:
                raw_end = start_t + target_dur
                if raw_end > duration:
                    continue

                # Snap start to downbeat or beat
                snapped_start = find_nearest(downbeat_arr, start_t, 1.2)
                downbeat_start = snapped_start is not None
                if snapped_start is None:
                    snapped_start = find_nearest(beat_arr, start_t, 0.6) or start_t

                # Snap end to downbeat or beat
                snapped_end = find_nearest(downbeat_arr, raw_end, 1.5)
                if snapped_end is None:
                    snapped_end = find_nearest(beat_arr, raw_end, 0.8) or raw_end

                cand_dur = round(snapped_end - snapped_start, 3)
                if cand_dur < min_dur or cand_dur > max_dur:
                    continue

                # Check if region already exists with near identical bounds
                duplicate = False
                for r in regions:
                    if abs(r['start'] - snapped_start) < 2.0 and abs(r['end'] - snapped_end) < 2.0:
                        duplicate = True
                        break
                if duplicate:
                    continue

                # Compute regional dynamics
                reg_beats = [b for b in beats if snapped_start <= b <= snapped_end]
                reg_downbeats = [d for d in downbeats if snapped_start <= d <= snapped_end]
                
                # Quality score calculation:
                # - downbeat start bonus
                # - beat alignment bonus
                # - duration suitability (optimal around 28-30s)
                # - section character
                dur_suitability = 1.0 - abs(cand_dur - 28.5) / 15.0
                quality = 0.40 * sec.get('energy', 0.5) + 0.25 * (1.0 if downbeat_start else 0.7) + 0.20 * max(0.0, dur_suitability) + 0.15 * sec.get('confidence', 0.8)

                regions.append({
                    'id': f"reg_{region_idx:02d}",
                    'start': round(snapped_start, 3),
                    'end': round(snapped_end, 3),
                    'duration': cand_dur,
                    'sectionLabel': sec_label,
                    'energy': sec.get('energy', 0.5),
                    'peakEnergy': sec.get('peakEnergy', 0.5),
                    'onsetDensity': sec.get('onsetDensity', 0.5),
                    'beatCount': len(reg_beats),
                    'downbeatCount': len(reg_downbeats),
                    'qualityScore': round(min(1.0, max(0.1, quality)), 4),
                    'beatAlignedStart': True,
                    'downbeatAlignedStart': downbeat_start,
                    'beatAlignedEnd': True
                })
                region_idx += 1

    # 2. Supplementary fallback coverage if few regions were generated
    if len(regions) < 4 and duration >= min_dur:
        step = max(min_dur * 0.7, (duration - min_dur) / 4.0)
        curr = 0.0
        while curr + min_dur <= duration:
            cand_end = min(duration, curr + 28.0)
            snapped_start = find_nearest(beat_arr, curr, 1.0) or curr
            snapped_end = find_nearest(beat_arr, cand_end, 1.0) or cand_end
            c_dur = round(snapped_end - snapped_start, 3)
            if c_dur >= min_dur:
                regions.append({
                    'id': f"reg_{region_idx:02d}",
                    'start': round(snapped_start, 3),
                    'end': round(snapped_end, 3),
                    'duration': c_dur,
                    'sectionLabel': 'verse',
                    'energy': 0.5,
                    'peakEnergy': 0.6,
                    'onsetDensity': 0.5,
                    'beatCount': len([b for b in beats if snapped_start <= b <= snapped_end]),
                    'downbeatCount': len([d for d in downbeats if snapped_start <= d <= snapped_end]),
                    'qualityScore': 0.75,
                    'beatAlignedStart': True,
                    'downbeatAlignedStart': False,
                    'beatAlignedEnd': True
                })
                region_idx += 1
            curr += step

    # Sort regions by start time
    regions.sort(key=lambda r: r['start'])
    return regions


def analyze_music_intelligence(
    audio_path: str,
    emit_fn: Optional[Any] = None
) -> Dict[str, Any]:
    """Executes the full music intelligence pipeline:

    1. Audio Normalization & probing
    2. BPM & precise beat grid extraction (Librosa)
    3. Low-frequency / spectral downbeat tracking (All-In-One-Infer architecture)
    4. Multi-signal Chroma & MFCC self-similarity matrix
    5. Foote checkerboard novelty boundary detection (MSAF reference)
    6. Structural sectioning & MIR functional label classification
    7. Phrase-aware candidate region generation
    """
    def emit(p: float, m: str):
        if emit_fn:
            emit_fn(progress=p, message=m)

    import librosa
    import soundfile as sf

    emit(0.08, 'Normalizing canonical analysis audio representation')
    # Load audio at standard 22050Hz mono
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    emit(0.25, 'Extracting BPM tempo and beat grid dynamics')
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    tempo_val = round(float(np.atleast_1d(tempo)[0]), 1)
    beat_times = [round(float(t), 3) for t in librosa.frames_to_time(beat_frames, sr=sr)]

    emit(0.40, 'Inferring downbeat timestamps and rhythmic bars')
    downbeats = detect_downbeats(beat_times, y, sr, tempo_val)

    emit(0.55, 'Computing harmonic and timbral self-similarity matrices')
    hop_length = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=hop_length)
    rms_arr = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)

    emit(0.70, 'Detecting structural boundaries via Foote checkerboard novelty')
    novelty = foote_novelty(chroma, mfcc, kernel_size=16)

    # Peak picking on novelty curve to identify section boundaries
    # Filter boundary peaks separated by at least 10 seconds (~430 frames at hop 512, sr 22050)
    min_dist_frames = int((10.0 * sr) / hop_length)
    peak_frames = []
    if len(novelty) > 0:
        threshold = float(np.mean(novelty) + 0.35 * np.std(novelty))
        for i in range(1, len(novelty) - 1):
            if novelty[i] > threshold and novelty[i] >= novelty[i - 1] and novelty[i] >= novelty[i + 1]:
                if not peak_frames or (i - peak_frames[-1]) >= min_dist_frames:
                    peak_frames.append(i)

    # Convert peak frames to boundary timestamps
    boundary_times = [0.0] + [round(float(librosa.frames_to_time(f, sr=sr, hop_length=hop_length)), 3) for f in peak_frames]
    if boundary_times[-1] < duration - 8.0:
        boundary_times.append(round(duration, 3))
    else:
        boundary_times[-1] = round(duration, 3)

    emit(0.85, 'Classifying musical sections and energy curves')
    sections: List[Dict[str, Any]] = []
    prev_energy: Optional[float] = None
    
    # Calculate energy sections & labels
    for idx in range(len(boundary_times) - 1):
        s_start = boundary_times[idx]
        s_end = boundary_times[idx + 1]
        s_dur = round(s_end - s_start, 3)
        if s_dur < 1.0:
            continue

        f_start = int((s_start * sr) / hop_length)
        f_end = min(len(rms_arr), int((s_end * sr) / hop_length))
        
        sec_rms = rms_arr[f_start:f_end] if f_end > f_start else np.array([0.0])
        sec_onset = onset_env[f_start:f_end] if f_end > f_start else np.array([0.0])

        m_energy = float(np.mean(sec_rms)) if len(sec_rms) > 0 else 0.0
        p_energy = float(np.max(sec_rms)) if len(sec_rms) > 0 else 0.0
        m_onset = float(np.mean(sec_onset)) if len(sec_onset) > 0 else 0.0

        next_idx = idx + 1
        next_energy = None
        if next_idx < len(boundary_times) - 1:
            nf_start = int((boundary_times[next_idx] * sr) / hop_length)
            nf_end = min(len(rms_arr), int((boundary_times[next_idx + 1] * sr) / hop_length))
            if nf_end > nf_start:
                next_energy = float(np.mean(rms_arr[nf_start:nf_end]))

        label, confidence = classify_section_label(
            s_start, s_end, duration, m_energy, p_energy, m_onset, prev_energy, next_energy
        )
        prev_energy = m_energy

        sec_beats = [b for b in beat_times if s_start <= b < s_end]
        sec_downbeats = [d for d in downbeats if s_start <= d < s_end]

        sections.append({
            'start': s_start,
            'end': s_end,
            'duration': s_dur,
            'energy': round(m_energy, 4),
            'peakEnergy': round(p_energy, 4),
            'onsetDensity': round(m_onset, 4),
            'beatCount': len(sec_beats),
            'downbeatCount': len(sec_downbeats),
            'label': label,
            'confidence': round(confidence, 3)
        })

    # Identify strong beats (high onset strength)
    strong_beats = []
    if len(beat_times) > 0 and len(onset_env) > 0:
        beat_frames_all = librosa.time_to_frames(np.array(beat_times), sr=sr, hop_length=hop_length)
        valid_frames = [f for f in beat_frames_all if f < len(onset_env)]
        if valid_frames:
            strengths = np.array([float(onset_env[f]) for f in valid_frames])
            p70 = float(np.percentile(strengths, 70)) if len(strengths) > 1 else 0.0
            for idx, f in enumerate(valid_frames):
                if float(onset_env[f]) >= p70 and idx < len(beat_times):
                    strong_beats.append(beat_times[idx])

    emit(0.95, 'Generating beat-aligned candidate music regions')
    regions = generate_candidate_regions(sections, beat_times, downbeats, duration)

    # Traditional 2-second energy buckets for backwards compatibility with legacy UI
    energy_sections = []
    bucket_sec = 2.0
    times = librosa.frames_to_time(np.arange(len(rms_arr)), sr=sr, hop_length=hop_length)
    for t_start in [float(x) for x in np.arange(0, duration, bucket_sec)]:
        t_end = min(duration, t_start + bucket_sec)
        mask = (times >= t_start) & (times < t_end)
        mean_e = float(np.mean(rms_arr[mask])) if np.any(mask) else 0.0
        energy_sections.append({
            'start': round(float(t_start), 2),
            'end': round(float(t_end), 2),
            'energy': round(mean_e, 4)
        })

    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop_length)
    onset_times = [round(float(t), 3) for t in librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)]

    result = {
        'version': 2,
        'duration': round(duration, 3),
        'bpm': tempo_val,
        'beats': beat_times,
        'downbeats': downbeats,
        'strongBeats': strong_beats,
        'sections': sections,
        'energySections': energy_sections,
        'onsetTimes': onset_times[:500],
        'regions': regions,
        'analyzer': 'AllInOne-MSAF-Librosa-Fused-v2'
    }

    emit(1.0, f'Music mapped · {tempo_val} BPM with {len(sections)} sections and {len(regions)} candidate regions')
    return result
