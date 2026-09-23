# Third-party components

This personal build includes Electron, React, TypeScript, FFmpeg, yt-dlp, portable CPython, faster-whisper/CTranslate2, Silero VAD, ONNX Runtime, OpenCV YuNet, Sherpa ONNX speaker embeddings, PySceneDetect, librosa, Whisper small and Noto fonts.

Upstream licenses and notices are preserved in the packaged runtime and generated dependency inventory. Python packages retain their distribution metadata in the portable runtime. Electron bundles its licenses. Noto fonts use the SIL Open Font License. The Whisper model is MIT licensed.

REELMIND packages the separate BtbN FFmpeg 9 Windows LGPL build and invokes its executables as subprocesses. The build reports LGPL v3 or later and includes its license. It supplies NVENC, OpenH264/Media Foundation fallback, libass captions, audio denoising and normalization without the earlier GPL build. FFmpeg sources and reproducible build definitions are linked from the generated inventory.

Runtime dependency downloads are defined in `scripts/setup-runtime.ps1` and `workers/requirements.txt`. Free cloud access is controlled by the respective providers and is not guaranteed by this application.

## Local model upgrade

- Bundled [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`: Apache-2.0. Uses the quantized AVX2 ONNX export and tokenizer, with masked mean pooling and 128-token windows.
- Optional [faster-whisper-large-v3-turbo](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo), revision `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf`: MIT. Converted Whisper large-v3-turbo weights, downloaded only on request; not included in the installer.
- ONNX Runtime and Hugging Face Tokenizers are included in the Python runtime with their upstream license metadata. Pinned file sizes and SHA-256 hashes are in `shared/model-manifest.json`.
