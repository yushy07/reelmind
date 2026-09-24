# pyright: reportGeneralTypeIssues=false
# pyright: reportArgumentType=false
# pyright: reportCallIssue=false
# pyright: reportOperatorIssue=false
"""Shared faster-whisper transcription engine for ReelMind.
Used by both Podcast Studio (worker.py) and Anime Studio (anime_worker.py).
"""
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
            offset = float(start / 16000)
            chunk: Any = audio[start:start + chunk_len]

            if explicit_language:
                lang = explicit_language
                prob = 1.0
            else:
                lang, prob, _ = model_any.detect_language(audio=chunk, vad_filter=False)
                if prob < 0.45:
                    lang = 'en'

            # English captions requirement:
            # If speech is English: task="transcribe"
            # If speech is non-English (Hindi, Japanese, Spanish, etc.):
            # faster-whisper task="translate" translates to fluent English with exact word-level timing
            # The original spoken audio is preserved intact for video export.
            is_english = (lang == 'en')
            task_mode = 'transcribe' if is_english else 'translate'

            segments, _ = model_any.transcribe(
                chunk,
                beam_size=5,
                word_timestamps=True,
                vad_filter=True,
                language=lang,
                task=task_mode,
                condition_on_previous_text=False
            )

            for s in list(segments):
                if s.no_speech_prob > 0.75 or not s.words:
                    continue

                words = [
                    {
                        'start': round(float(w.start + offset), 3),
                        'end': round(float(w.end + offset), 3),
                        'text': str(w.word),
                        'probability': round(float(w.probability), 4)
                    }
                    for w in s.words if w.end > w.start
                ]
                if not words:
                    continue

                sample_start = max(0, int(s.start * 16000))
                sample_end = min(len(chunk), int(s.end * 16000))
                sample: Any = chunk[sample_start:sample_end]
                energy_val = float(np_any.sqrt(np_any.mean(sample ** 2))) if len(sample) else 0.0

                result.append({
                    'start': float(words[0]['start']),
                    'end': float(words[-1]['end']),
                    'text': str(s.text).strip(),
                    'language': 'en',
                    'source_language': lang,
                    'language_probability': round(float(prob), 4),
                    'energy': round(energy_val, 4),
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
