# Third-party components

This personal build includes Electron, React, TypeScript, FFmpeg, yt-dlp, portable CPython, faster-whisper/CTranslate2, Silero VAD, ONNX Runtime, OpenCV YuNet, Sherpa ONNX speaker embeddings, Whisper small and Noto fonts.

Upstream licenses and notices are preserved in the packaged runtime and generated dependency inventory. Python packages retain their distribution metadata in the portable runtime. Electron bundles its licenses. Noto fonts use the SIL Open Font License. The Whisper model is MIT licensed.

REELMIND packages the separate BtbN FFmpeg 9 Windows LGPL build and invokes its executables as subprocesses. The build reports LGPL v3 or later and includes its license. It supplies NVENC, OpenH264/Media Foundation fallback, libass captions, audio denoising and normalization without the earlier GPL build. FFmpeg sources and reproducible build definitions are linked from the generated inventory.

Runtime dependency downloads are defined in `scripts/setup-runtime.ps1` and `workers/requirements.txt`. Free cloud access is controlled by the respective providers and is not guaranteed by this application.
