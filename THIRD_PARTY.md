# Third-party components

This personal build includes Electron, React, TypeScript, FFmpeg, yt-dlp, portable CPython, faster-whisper/CTranslate2, Silero VAD, ONNX Runtime, OpenCV YuNet, Sherpa ONNX speaker embeddings, Whisper small and Noto fonts.

Upstream licenses and notices must be preserved when redistributing binaries. Python packages retain their distribution metadata in the portable runtime. Electron bundles its licenses. Noto fonts use the SIL Open Font License. The Whisper model is MIT licensed. FFmpeg build licensing depends on its configured components; the full Windows build used locally includes GPL components. Review its bundled license and corresponding-source obligations before public distribution. REELMIND has no paid model dependency.

Runtime dependency downloads are defined in `scripts/setup-runtime.ps1` and `workers/requirements.txt`. Free cloud access is controlled by the respective providers and is not guaranteed by this application.
