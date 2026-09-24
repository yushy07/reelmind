# pyright: reportGeneralTypeIssues=false
# pyright: reportOperatorIssue=false
# pyright: reportAttributeAccessIssue=false
# pyright: reportIndexIssue=false
# pyright: reportCallIssue=false
# pyright: reportArgumentType=false
"""Offline MiniLM embeddings; every token participates in a bounded 128-token window."""
import argparse
import json
import os
from pathlib import Path
from typing import Any

def embed(texts, model_dir):
    import numpy as np  # type: ignore
    import onnxruntime as ort  # type: ignore
    from tokenizers import Tokenizer  # type: ignore
    np_any: Any = np
    tokenizer: Any = Tokenizer.from_file(str(Path(model_dir) / 'tokenizer.json'))
    tokenizer.enable_truncation(max_length=128, stride=0)
    options: Any = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session: Any = ort.InferenceSession(str(Path(model_dir) / 'model.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    names = {item.name for item in session.get_inputs()}
    vectors = []
    for text in texts:
        if not text.strip():
            raise ValueError('Candidate has no transcript text')
        encoded: Any = tokenizer.encode(text)
        pooled, weights = [], []
        for window in [encoded] + encoded.overflowing:
            attn_mask: Any = np_any.array([window.attention_mask], dtype=np_any.int64)
            inputs: dict[str, Any] = {
                'input_ids': np_any.array([window.ids], dtype=np_any.int64),
                'attention_mask': attn_mask,
                'token_type_ids': np_any.array([window.type_ids], dtype=np_any.int64)
            }
            hidden: Any = session.run(None, {k: v for k, v in inputs.items() if k in names})[0]
            mask: Any = np_any.expand_dims(attn_mask, -1)
            mask_sum = float(np_any.sum(mask))
            pooled.append((hidden * mask).sum(axis=1)[0] / max(1.0, mask_sum))
            weights.append(max(1, sum(window.attention_mask) - sum(window.special_tokens_mask)))
        vector: Any = np_any.average(pooled, axis=0, weights=weights)
        norm: float = float(np_any.linalg.norm(vector))
        if vector.shape != (384,) or not np_any.isfinite(vector).all() or norm < 1e-8:
            raise ValueError('Invalid model embedding')
        vectors.append((vector / norm).tolist())
    return vectors

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['input', 'output', 'models']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    texts = json.loads(Path(args.input).read_text(encoding='utf-8'))
    result = embed(texts, args.models)
    temporary = args.output + '.tmp'
    Path(temporary).write_text(json.dumps(result), encoding='utf-8')
    os.replace(temporary, args.output)
