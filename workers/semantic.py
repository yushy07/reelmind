"""Offline MiniLM embeddings; every token participates in a bounded 128-token window."""
import argparse
import json
import os
from pathlib import Path

def embed(texts, model_dir):
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    tokenizer = Tokenizer.from_file(str(Path(model_dir) / 'tokenizer.json'))
    tokenizer.enable_truncation(max_length=128, stride=0)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(Path(model_dir) / 'model.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    names = {item.name for item in session.get_inputs()}
    vectors = []
    for text in texts:
        if not text.strip():
            raise ValueError('Candidate has no transcript text')
        encoded = tokenizer.encode(text)
        pooled, weights = [], []
        for window in [encoded] + encoded.overflowing:
            inputs = {'input_ids': np.array([window.ids], dtype=np.int64),
                      'attention_mask': np.array([window.attention_mask], dtype=np.int64),
                      'token_type_ids': np.array([window.type_ids], dtype=np.int64)}
            hidden = session.run(None, {k: v for k, v in inputs.items() if k in names})[0]
            mask = inputs['attention_mask'][..., None]
            pooled.append((hidden * mask).sum(axis=1)[0] / max(1, mask.sum()))
            weights.append(max(1, sum(window.attention_mask) - sum(window.special_tokens_mask)))
        vector = np.average(pooled, axis=0, weights=weights)
        norm = np.linalg.norm(vector)
        if vector.shape != (384,) or not np.isfinite(vector).all() or norm < 1e-8:
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
