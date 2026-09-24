# pyright: reportGeneralTypeIssues=false
# pyright: reportArgumentType=false
# pyright: reportCallIssue=false
# pyright: reportOperatorIssue=false
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
    import numpy as np  # type: ignore
    from faster_whisper import WhisperModel  # type: ignore
    from faster_whisper.audio import decode_audio  # type: ignore

    np_any: Any = np
    audio: Any = decode_audio(audio_path, sampling_rate=16000)

    def run_model(model: WhisperModel, device: str) -> List[Dict[str, Any]]:
        model_any: Any = model
        result = []
        chunk_len = 30 * 16000
        total_len = len(audio)

        for start in range(0, total_len, chunk_len):
            offset = start / 16000
            chunk: Any = audio[start:start + chunk_len]
            provisional, _ = model_any.transcribe(
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
                sample: Any = chunk[sample_start:sample_end]

                if explicit_language:
                    lang = explicit_language
                    prob = 1.0
                else:
                    lang, prob, _ = model_any.detect_language(audio=sample, vad_filter=False)
                    if prob < 0.45:
                        lang = 'en'

                # English captions requirement:
                # If speech is English: task="transcribe"
                # If speech is non-English (Hindi, Japanese, Spanish, etc.):
                # faster-whisper task="translate" translates to fluent English with exact word-level timing
                # The original spoken audio is preserved intact for video export.
                is_english = (lang == 'en')
                task_mode = 'transcribe' if is_english else 'translate'

                orig_segments = []
                if not is_english:
                    try:
                        orig_provisional, _ = model_any.transcribe(
                            sample,
                            beam_size=3,
                            word_timestamps=False,
                            vad_filter=False,
                            language=lang,
                            task='transcribe',
                            condition_on_previous_text=False
                        )
                        orig_segments = [p for p in orig_provisional if getattr(p, 'text', None) and p.text.strip()]
                    except Exception:
                        pass

                refined, _ = model_any.transcribe(
                    sample,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                    language=lang,
                    task=task_mode,
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
                        if is_english:
                            seg_orig_text = part.text.strip()
                        else:
                            matching_orig = [
                                p.text.strip()
                                for p in orig_segments
                                if (p.start < part.end and p.end > part.start)
                            ]
                            if matching_orig:
                                seg_orig_text = ' '.join(matching_orig).strip()
                            elif len(orig_segments) == 1:
                                seg_orig_text = orig_segments[0].text.strip()
                            elif orig_segments:
                                part_center = (part.start + part.end) / 2.0
                                closest = min(orig_segments, key=lambda p: abs(((p.start + p.end) / 2.0) - part_center))
                                seg_orig_text = closest.text.strip()
                            else:
                                seg_orig_text = ""

                        energy_val = float(np_any.sqrt(np_any.mean(sample ** 2))) if len(sample) else 0.0
                        result.append({
                            'start': words[0]['start'],
                            'end': words[-1]['end'],
                            'text': part.text.strip(),
                            'language': 'en',
                            'source_language': lang,
                            'original_text': seg_orig_text,
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

    model = None
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
        finally:
            if model is not None:
                del model
                model = None
                import gc
                gc.collect()
                try:
                    import torch
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception:
                    pass

    if result is None:
        model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
        result = run_model(model, 'CPU')
        del model
        import gc
        gc.collect()

    if not result:
        raise ValueError('No clear speech found in this video.')

    primary_source_lang = result[0].get('source_language', 'en') if result else 'en'
    return {
        'version': 1,
        'duration': len(audio) / 16000,
        'language': 'en',
        'source_language': primary_source_lang,
        'segments': result
    }
