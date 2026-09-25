# pyright: reportGeneralTypeIssues=false
# pyright: reportArgumentType=false
# pyright: reportCallIssue=false
# pyright: reportOperatorIssue=false
# pyright: reportIndexIssue=false
# pyright: reportAttributeAccessIssue=false
# pyright: reportOptionalMemberAccess=false
# pyright: reportUnnecessaryCast=false
# pyright: reportOptionalSubscript=false
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
import numpy as np  # type: ignore

np_any: Any = np

# Ensure shared GPU initialization is available
try:
    from shared.gpu import setup_cuda_environment
    setup_cuda_environment()
except Exception:
    pass

# Production Duration Contract
MIN_MUSIC_REGION_DURATION: float = 25.0
DEFAULT_TARGET_DURATIONS: List[float] = [25.0, 30.0, 45.0, 60.0]


def foote_novelty(chroma: Any, mfcc: Any, kernel_size: int = 16) -> Any:
    """Computes a structural novelty curve using Foote's checkerboard kernel over

    combined chroma (harmonic) and MFCC (timbral) self-similarity matrices.
    Reference: MSAF structural segmentation & Foote (2000).
    """
    n_frames = chroma.shape[1]
    if n_frames < kernel_size:
        return np_any.zeros(n_frames, dtype=np_any.float32)

    # Normalize feature vectors across time
    eps = 1e-8
    chroma_norm: Any = chroma / (np_any.linalg.norm(chroma, axis=0, keepdims=True) + eps)
    mfcc_norm: Any = mfcc / (np_any.linalg.norm(mfcc, axis=0, keepdims=True) + eps)

    # Construct Foote checkerboard kernel with Gaussian taper
    half = kernel_size // 2
    kernel: Any = np_any.zeros((kernel_size, kernel_size), dtype=np_any.float32)
    kernel[:half, :half] = 1.0
    kernel[half:, half:] = 1.0
    kernel[:half, half:] = -1.0
    kernel[half:, :half] = -1.0

    t: Any = np_any.linspace(-2.0, 2.0, kernel_size, dtype=np_any.float32)
    gaussian_1d: Any = np_any.exp(-t**2)
    taper: Any = np_any.outer(gaussian_1d, gaussian_1d)
    kernel = kernel * taper

    # Fast 1D diagonal extraction correlation computed directly from local slices
    # to avoid materializing O(N^2) full self-similarity matrices on long tracks
    novelty: Any = np_any.zeros(n_frames, dtype=np_any.float32)
    for i in range(half, n_frames - half):
        c_sub = chroma_norm[:, i - half : i + half]
        m_sub = mfcc_norm[:, i - half : i + half]
        sub_ssm: Any = 0.5 * (np_any.dot(c_sub.T, c_sub) + np_any.dot(m_sub.T, m_sub))
        novelty[i] = float(np_any.sum(sub_ssm * kernel))

    # Half-wave rectification and normalization
    novelty = np_any.maximum(0.0, novelty)
    max_val = float(np_any.max(novelty)) if np_any.max(novelty) > eps else 1.0
    return novelty / max_val


def detect_downbeats(beat_times: List[float], y: Any, sr: int, bpm: float) -> List[float]:
    """Infers downbeat timestamps (bar heads, typically 4/4 or 3/4 meter)

    by evaluating spectral flux, low-frequency bass impact, and onset energy at beat positions.
    Inspired by All-In-One-Infer / madmom beat-downbeat tracking models.
    """
    if len(beat_times) < 4:
        return beat_times[:]

    import librosa  # type: ignore
    librosa_any: Any = librosa

    # Compute onset strength and sub-bass energy (frequencies <= 160Hz)
    hop_length = 512
    onset_env: Any = librosa_any.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    
    # Filter for low-frequency kick/bass energy
    stft: Any = np_any.abs(librosa_any.stft(y, n_fft=2048, hop_length=hop_length))
    freqs: Any = librosa_any.fft_frequencies(sr=sr, n_fft=2048)
    bass_mask: Any = freqs <= 160.0
    bass_energy: Any = np_any.mean(stft[bass_mask, :], axis=0) if np_any.any(bass_mask) else onset_env

    # Measure beat saliency
    beat_frames: Any = librosa_any.time_to_frames(np_any.array(beat_times), sr=sr, hop_length=hop_length)
    saliency = []
    for f in list(beat_frames):
        if f < len(onset_env) and f < len(bass_energy):
            sal = float(0.6 * onset_env[f] + 0.4 * (bass_energy[f] / (np_any.max(bass_energy) + 1e-6)))
            saliency.append(sal)
        else:
            saliency.append(0.0)

    # Test 4-beat bar alignments (4/4 time signature dominant in modern/anime soundtracks)
    best_phase = 0
    best_phase_score = -1.0
    for phase in range(min(4, len(saliency))):
        phase_scores = [saliency[i] for i in range(phase, len(saliency), 4)]
        avg_score = float(np_any.mean(phase_scores)) if phase_scores else 0.0
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
    Conforms to MIR functional segment taxonomy, calibrated on normalized relative energy.
    """
    dur = end - start
    pos = (start + end) / (2.0 * max(1.0, total_duration))

    # 1. Positional intros and outros
    if start < 15.0 and pos < 0.15 and mean_energy < 0.55:
        return ('intro', 0.90)
    if end >= total_duration - 15.0 and pos > 0.85 and mean_energy < 0.60:
        return ('outro', 0.88)

    # Dynamics trajectory
    e_jump = (mean_energy - prev_energy) if prev_energy is not None else 0.0
    e_drop = (prev_energy - mean_energy) if prev_energy is not None else 0.0

    # 2. Climax / High-intensity drops
    if peak_energy >= 0.80 and (mean_energy >= 0.50 or onset_density >= 0.45):
        if e_jump >= 0.10:
            return ('drop', 0.92)
        if pos > 0.55 and mean_energy >= 0.55:
            return ('climax', 0.90)
        return ('chorus', 0.88)

    # 3. Builds and high energy choruses
    if mean_energy >= 0.50:
        if e_jump >= 0.15:
            return ('drop', 0.86)
        return ('chorus', 0.85)

    # 4. Breaks and bridges (calm / interlude moments)
    if mean_energy <= 0.32:
        if e_drop >= 0.15 and 0.20 <= pos <= 0.80:
            return ('break', 0.88)
        if 0.25 <= pos <= 0.80:
            return ('break', 0.82)
        return ('ambient', 0.80)

    if 0.40 <= pos <= 0.80 and (prev_energy or 0.5) > mean_energy and mean_energy < 0.45:
        return ('bridge', 0.84)

    # 5. Default rhythmic verse
    return ('verse', 0.80)


def generate_candidate_regions(
    sections: List[Dict[str, Any]],
    beats: List[float],
    downbeats: List[float],
    duration: float,
    min_dur: float = MIN_MUSIC_REGION_DURATION,
    max_dur: float = 65.0,
    target_durations: Optional[List[float]] = None
) -> List[Dict[str, Any]]:
    """Generates beat and downbeat-snapped candidate music regions across the song.

    Ensures musical phrase completeness, enforces the MIN_MUSIC_REGION_DURATION (>=25s) contract,
    avoids mid-beat truncations, and supports configurable target durations [25, 30, 45, 60s].
    """
    if target_durations is None:
        target_durations = DEFAULT_TARGET_DURATIONS

    # If the track itself is shorter than the minimum duration contract, provide an explicit fallback region
    if duration < min_dur:
        return [{
            'id': 'reg_01',
            'start': 0.0,
            'end': round(duration, 3),
            'duration': round(duration, 3),
            'sectionLabel': sections[0].get('label', 'verse') if sections else 'verse',
            'energy': sections[0].get('energy', 0.5) if sections else 0.5,
            'peakEnergy': sections[0].get('peakEnergy', 0.5) if sections else 0.5,
            'onsetDensity': sections[0].get('onsetDensity', 0.5) if sections else 0.5,
            'beatCount': len(beats),
            'downbeatCount': len(downbeats),
            'qualityScore': 0.5,
            'beatAlignedStart': True,
            'downbeatAlignedStart': False,
            'beatAlignedEnd': True,
            'isFallback': True
        }]

    regions: List[Dict[str, Any]] = []
    beat_arr: Any = np_any.array(beats) if beats else np_any.array([])
    downbeat_arr: Any = np_any.array(downbeats) if downbeats else np_any.array([])

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
            # Snap start to downbeat or beat
            if len(downbeat_arr) > 0:
                idx = int(np_any.argmin(np_any.abs(downbeat_arr - start_t)))
                val = float(downbeat_arr[idx])
                snapped_start = val if abs(val - start_t) <= 1.2 else None
            else:
                snapped_start = None
            downbeat_start = snapped_start is not None
            if snapped_start is None:
                if len(beat_arr) > 0:
                    idx = int(np_any.argmin(np_any.abs(beat_arr - start_t)))
                    val = float(beat_arr[idx])
                    snapped_start = val if abs(val - start_t) <= 0.6 else start_t
                else:
                    snapped_start = start_t

            for target_dur in target_durations:
                raw_end = snapped_start + target_dur
                if raw_end > duration + 1.5:
                    continue

                # Snap end: strictly enforce that snapped_end - snapped_start >= min_dur
                valid_end_db = [d for d in downbeats if d >= snapped_start + min_dur and d <= duration]
                if valid_end_db:
                    snapped_end = min(valid_end_db, key=lambda d: abs(d - raw_end))
                else:
                    valid_end_b = [b for b in beats if b >= snapped_start + min_dur and b <= duration]
                    if valid_end_b:
                        snapped_end = min(valid_end_b, key=lambda b: abs(b - raw_end))
                    else:
                        snapped_end = duration if duration - snapped_start >= min_dur else None

                if snapped_end is None:
                    continue

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
                # - proximity to requested target duration
                # - section character and confidence
                min_dist_to_target = min(abs(cand_dur - td) for td in target_durations)
                dur_suitability = max(0.0, 1.0 - (min_dist_to_target / 12.0))
                quality = (
                    0.35 * sec.get('energy', 0.5) +
                    0.25 * (1.0 if downbeat_start else 0.7) +
                    0.25 * dur_suitability +
                    0.15 * sec.get('confidence', 0.8)
                )

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
            target_dur = 30.0 if curr + 30.0 <= duration else min_dur
            raw_end = curr + target_dur
            if len(beat_arr) > 0:
                idx = int(np_any.argmin(np_any.abs(beat_arr - curr)))
                val = float(beat_arr[idx])
                snapped_start = val if abs(val - curr) <= 1.0 else curr
            else:
                snapped_start = curr
            valid_b = [b for b in beats if b >= snapped_start + min_dur and b <= duration]
            snapped_end = min(valid_b, key=lambda b: abs(b - raw_end)) if valid_b else duration
            c_dur = round(snapped_end - snapped_start, 3)
            if c_dur >= min_dur:
                if not any(abs(r['start'] - snapped_start) < 2.0 and abs(r['end'] - snapped_end) < 2.0 for r in regions):
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

    import librosa  # type: ignore
    import soundfile as sf  # type: ignore

    librosa_any: Any = librosa
    sf_any: Any = sf

    emit(0.08, 'Normalizing canonical analysis audio representation')
    # Load audio at standard 22050Hz mono
    y: Any
    sr: Any
    y, sr = librosa_any.load(audio_path, sr=22050, mono=True)
    duration = float(librosa_any.get_duration(y=y, sr=sr))

    emit(0.25, 'Extracting BPM tempo and beat grid dynamics')
    tempo, beat_frames = librosa_any.beat.beat_track(y=y, sr=sr)
    tempo_val = round(float(np_any.atleast_1d(tempo)[0]), 1)
    beat_times = [round(float(t), 3) for t in list(librosa_any.frames_to_time(beat_frames, sr=sr))]

    emit(0.40, 'Inferring downbeat timestamps and rhythmic bars')
    downbeats = detect_downbeats(beat_times, y, int(sr), tempo_val)

    emit(0.55, 'Computing harmonic and timbral self-similarity matrices')
    hop_length = 512
    chroma: Any = librosa_any.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    mfcc: Any = librosa_any.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=hop_length)
    rms_arr: Any = librosa_any.feature.rms(y=y, hop_length=hop_length)[0]
    onset_env: Any = librosa_any.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)

    emit(0.70, 'Detecting structural boundaries via Foote checkerboard novelty')
    novelty: Any = foote_novelty(chroma, mfcc, kernel_size=16)

    # Bar duration derivation & adaptive structural boundary separation
    if len(downbeats) >= 2:
        bar_duration = float(np_any.median(np_any.diff(downbeats)))
    else:
        bar_duration = 4.0 * (60.0 / max(40.0, tempo_val))

    # Adaptive boundary spacing: 4 musical bars, clamped to [5.0s, 14.0s]
    min_dist_sec = max(5.0, min(14.0, 4.0 * bar_duration))
    min_dist_frames = int((min_dist_sec * sr) / hop_length)

    # Peak picking on novelty curve to identify section boundaries
    peak_frames = []
    if len(novelty) > 0:
        threshold = float(np_any.mean(novelty) + 0.35 * np_any.std(novelty))
        for i in range(1, len(novelty) - 1):
            if novelty[i] > threshold and novelty[i] >= novelty[i - 1] and novelty[i] >= novelty[i + 1]:
                if not peak_frames or (i - peak_frames[-1]) >= min_dist_frames:
                    peak_frames.append(i)

    # Convert peak frames to boundary timestamps and snap to nearest musical downbeats
    raw_boundaries = [float(librosa_any.frames_to_time(f, sr=sr, hop_length=hop_length)) for f in peak_frames]
    boundary_times = [0.0]
    for bt in raw_boundaries:
        if downbeats:
            nearest_db = min(downbeats, key=lambda d: abs(d - bt))
            if abs(nearest_db - bt) <= 1.2:
                bt = nearest_db
        if bt > boundary_times[-1] + (min_dist_sec * 0.7):
            boundary_times.append(round(float(bt), 3))

    if boundary_times[-1] < duration - (min_dist_sec * 0.8):
        boundary_times.append(round(duration, 3))
    else:
        boundary_times[-1] = round(duration, 3)

    emit(0.85, 'Classifying musical sections and energy curves')
    sections: List[Dict[str, Any]] = []
    prev_energy: Optional[float] = None

    # Percentile-based robust per-track normalization (scale-invariant across loud/quiet masters)
    p05_r = float(np_any.percentile(rms_arr, 5)) if len(rms_arr) > 0 else 0.0
    p95_r = float(np_any.percentile(rms_arr, 95)) if len(rms_arr) > 0 else 1.0
    rms_norm: Any = np_any.clip((rms_arr - p05_r) / (p95_r - p05_r + 1e-8), 0.0, 1.0) if p95_r > p05_r else np_any.clip(rms_arr / (np_any.max(rms_arr) + 1e-8), 0.0, 1.0)

    p10_o = float(np_any.percentile(onset_env, 10)) if len(onset_env) > 0 else 0.0
    p90_o = float(np_any.percentile(onset_env, 90)) if len(onset_env) > 0 else 1.0
    onset_norm: Any = np_any.clip((onset_env - p10_o) / (p90_o - p10_o + 1e-8), 0.0, 1.0) if p90_o > p10_o else np_any.clip(onset_env / (np_any.max(onset_env) + 1e-8), 0.0, 1.0)

    # Calculate energy sections & labels
    for idx in range(len(boundary_times) - 1):
        s_start = boundary_times[idx]
        s_end = boundary_times[idx + 1]
        s_dur = round(s_end - s_start, 3)
        if s_dur < 1.0:
            continue

        f_start = int((s_start * sr) / hop_length)
        f_end = min(len(rms_norm), int((s_end * sr) / hop_length))

        sec_rms: Any = rms_norm[f_start:f_end] if f_end > f_start else np_any.array([0.0])
        sec_onset: Any = onset_norm[f_start:f_end] if f_end > f_start else np_any.array([0.0])

        m_energy = float(np_any.clip(np_any.mean(sec_rms), 0.0, 1.0)) if len(sec_rms) > 0 else 0.0
        p_energy = float(np_any.clip(np_any.max(sec_rms), 0.0, 1.0)) if len(sec_rms) > 0 else 0.0
        m_onset = float(np_any.clip(np_any.mean(sec_onset), 0.0, 1.0)) if len(sec_onset) > 0 else 0.0

        next_idx = idx + 1
        next_energy = None
        if next_idx < len(boundary_times) - 1:
            nf_start = int((boundary_times[next_idx] * sr) / hop_length)
            nf_end = min(len(rms_norm), int((boundary_times[next_idx + 1] * sr) / hop_length))
            if nf_end > nf_start:
                next_energy = float(np_any.clip(np_any.mean(rms_norm[nf_start:nf_end]), 0.0, 1.0))

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
        beat_frames_all: Any = librosa_any.time_to_frames(np_any.array(beat_times), sr=sr, hop_length=hop_length)
        valid_frames = [f for f in list(beat_frames_all) if f < len(onset_env)]
        if valid_frames:
            strengths: Any = np_any.array([float(onset_env[f]) for f in valid_frames])
            p70 = float(np_any.percentile(strengths, 70)) if len(strengths) > 1 else 0.0
            for idx, f in enumerate(valid_frames):
                if float(onset_env[f]) >= p70 and idx < len(beat_times):
                    strong_beats.append(beat_times[idx])

    emit(0.95, 'Generating beat-aligned candidate music regions')
    regions = generate_candidate_regions(sections, beat_times, downbeats, duration)

    # Traditional 2-second energy buckets for backwards compatibility with legacy UI
    energy_sections = []
    bucket_sec = 2.0
    times: Any = librosa_any.frames_to_time(np_any.arange(len(rms_norm)), sr=sr, hop_length=hop_length)
    for t_start in [float(x) for x in list(np_any.arange(0, duration, bucket_sec))]:
        t_end = min(duration, t_start + bucket_sec)
        mask: Any = (times >= t_start) & (times < t_end)
        mean_e = float(np_any.clip(np_any.mean(rms_norm[mask]), 0.0, 1.0)) if np_any.any(mask) else 0.0
        energy_sections.append({
            'start': round(float(t_start), 2),
            'end': round(float(t_end), 2),
            'energy': round(mean_e, 4)
        })

    onset_frames: Any = librosa_any.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop_length)
    onset_times = [round(float(t), 3) for t in list(librosa_any.frames_to_time(onset_frames, sr=sr, hop_length=hop_length))]

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
