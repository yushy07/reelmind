"""Shared faster-whisper transcription engine for ReelMind.
Used by both Podcast Studio (worker.py) and Anime Studio (anime_worker.py).
"""
import json
import os
from pathlib import Path
from typing import Callable, Optional, Dict, Any, List

def run_transcription(
    audio_path: str,
    model_path: str,
    gpu: bool = False,
    explicit_language: Optional[str] = None,
    emit: Optional[Callable[..., None]] = None,
) -> Dict[str, Any]:
    """Transcribes an audio file using faster-whisper.
    
    If explicit_language is provided (e.g. 'ja' or 'en'), uses that language.
    Otherwise re-detects language dynamically every 30s (for podcasts/Hindi/Hinglish/Japanese).
    """
    import numpy as np
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio

    audio = decode_audio(audio_path, sampling_rate=16000)

    def run_model(model: WhisperModel, device: str) -> List[Dict[str, Any]]:
        result = []
        chunk_len = 30 * 16000
        total_len = len(audio)

        for start in range(0, total_len, chunk_len):
            offset = start / 16000
            chunk = audio[start:start + chunk_len]
            provisional, _ = model.transcribe(
                chunk,
                beam_size=5,
                word_timestamps=True,
                vad_filter=True,
                condition_on_previous_text=False
            )
            for s in list(provisional):
                if s.no_speech_prob > 0.75 or not s.words:
                    continue

                sample_start = max(0, int((s.start - 0.2) * 16000))
                sample_end = min(len(chunk), int((s.end + 0.2) * 16000))
                sample = chunk[sample_start:sample_end]

                if explicit_language:
                    lang = explicit_language
                    prob = 1.0
                else:
                    lang, prob, _ = model.detect_language(audio=sample, vad_filter=False)
                    if prob < 0.45:
                        lang = 'en'

                refined, _ = model.transcribe(
                    sample,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                    language=lang,
                    condition_on_previous_text=False
                )
                base = offset + sample_start / 16000
                for part in refined:
                    if part.no_speech_prob > 0.75 or not part.words:
                        continue
                    words = [
                        {
                            'start': w.start + base,
                            'end': w.end + base,
                            'text': w.word,
                            'probability': w.probability
                        }
                        for w in part.words if w.end > w.start
                    ]
                    if words:
                        energy_val = float(np.sqrt(np.mean(sample ** 2))) if len(sample) else 0.0
                        result.append({
                            'start': words[0]['start'],
                            'end': words[-1]['end'],
                            'text': part.text.strip(),
                            'language': lang,
                            'language_probability': prob,
                            'energy': energy_val,
                            'words': words
                        })

            if emit:
                emit(
                    progress=min(0.99, (start + len(chunk)) / total_len),
                    message=f'Transcribing speech locally · {device}'
                )

        return result

    result = None
    if gpu:
        try:
            if emit:
                emit(progress=0, message='Starting GPU speech recognition')
            model = WhisperModel(model_path, device='cuda', compute_type='float16', local_files_only=True)
            result = run_model(model, 'GPU')
        except Exception:
            if emit:
                emit(fallback='GPU speech unavailable; using CPU instead', message='GPU speech unavailable · continuing on CPU')

    if result is None:
        model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
        result = run_model(model, 'CPU')

    if not result:
        raise ValueError('No clear speech found in this video.')

    return {
        'version': 1,
        'duration': len(audio) / 16000,
        'language': result[0]['language'],
        'segments': result
    }
