![REELMIND — Long videos. Strong moments.](assets/banner.svg)

# REELMIND

Windows desktop · Local-first processing · Apache 2.0 · Early personal-use V1

A personal Windows desktop studio for turning long videos into Instagram Reels. Electron + React interface, local speech and visual workers, optional free cloud analysis, FFmpeg exports.

## Run

For an existing Windows build, run `REELMIND Setup 0.1.0.exe`. The installer is generated locally; a public binary release is not published yet. The unsigned installer may trigger Windows SmartScreen.

On a fresh development machine:

1. Install Node.js 24 or newer and Git on 64-bit Windows, then clone and install:

   ```powershell
   git clone https://github.com/yushy07/reelmind.git
   cd reelmind
   npm ci
   git config core.hooksPath .githooks
   ```

2. Run `npm run setup:runtime`. This downloads portable Python, FFmpeg if needed, yt-dlp, models and fonts. Allow approximately 2 GB of disk space plus video working space.
3. Run `npm run build` and `npm start`.

The Windows installer includes the runtime and models, so the installed app does not need Python, FFmpeg, Rust or Node on PATH. Build it using `npm run package`. The installer is unsigned unless a signing certificate is supplied through electron-builder's signing environment variables.

## Use

Choose **New project**, select a local MP4/MOV/MKV/AVI/WebM or enter a public YouTube/direct-video HTTPS link, then **Generate Reels**. Processing and rendering are automatic. A project can return fewer than 12 Reels, or no clips if the ranking finds no suitable moment. Each export is 30–60 seconds, 1080×1920 H.264/AAC, with animated captions and source audio.

When ready, open **Save Reels** and select a folder outside REELMIND. Existing files are never overwritten. Copies are checked before internal output files are removed. Projects do not have a timeline editor.

Settings accepts Gemini and OpenRouter keys. Keys go to Windows Credential Manager. Leave a field untouched to retain its stored key; the removal action clears it when settings are saved. Gemini calls require confirmation that the user's API project has billing disabled; the application cannot inspect provider billing. Only `openrouter/free` or models ending in `:free` are accepted for OpenRouter. With no keys, processing runs locally. Cloud services receive transcript text and timestamps, never video or audio.

## Processing

- Import a private source copy, inspect media, extract audio.
- Transcribe in 30-second language-detected windows using faster-whisper small on CPU INT8, with Silero VAD and word timestamps.
- Cluster speaker embeddings with Sherpa ONNX; detect faces using OpenCV YuNet; connect reliable mouth-motion observations to speaker labels.
- Analyze overlapping transcript sections with provider fallback, then rank and remove overlap globally. Local selection is heuristic, not a local large language model.
- Generate versioned edit plans with caption timing, conservative silence cuts, framing, split layouts and alternating punch-ins.
- Render one clip at a time in batches of up to three to bound memory. Try NVIDIA H.264 encoding first, then software encoding. Audio normalization uses only source audio.

## Storage and recovery

Application data lives in Electron's per-user `REELMIND`/`reelmind` data directory. SQLite stores job state and settings; workspaces and outputs are separate directories.

- Success: a 24-hour deadline applies to source copies, transcripts, plans, audio and cache.
- Interruption: preserve completed stages for 24 hours. **Restore & continue** restarts the interrupted stage and reuses completed artifacts.
- Unsaved finished Reels survive automatic cleanup. Explicit project deletion removes these too, after a confirmation.
- Cleanup runs once a minute while the app is open and on the next launch. It does not run while Windows/the app is closed.
- Original imported files and externally saved outputs are never cleanup targets.

## Verification

`npm test` runs provider fallback, selection, captions, SQLite, export boundary, cleanup and recovery checks. `npm run build` type-checks and bundles the application.

Additional integration tools:

- `node scripts/run-electron-smoke.mjs`: real Electron launch, bridge check and offscreen screenshots with an isolated profile.
- `npx tsx scripts/render-smoke.ts`: synthetic multilingual 1080×1920 export.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/speech-fixture.ps1`, then `npx tsx scripts/pipeline-smoke.ts`: a generated speech video through the complete local pipeline and verified external save.

Test artifacts are under `.test-data/`, which Git ignores. The pipeline test writes its verified export into an explicitly named temporary directory and prints that location.

## Current limits

Speech and speaker accuracy depend on the recording. Very short turns, overlapping voices, rapid code switching and scene cuts can confuse speaker matching. Low-confidence scenes keep a stable composition. Local heuristic ranking is less capable than cloud semantic analysis; neither mode promises virality or human editorial quality.

English, Hindi/Hinglish and Japanese are the first target languages. Real multilingual and multi-speaker podcast evaluation is still needed; synthetic tests validate the pipeline, not editorial quality. Public link downloaders depend on third-party sites and can require updates. No authenticated, live or DRM bypass is supported. Final captions may contain transcription errors because V1 intentionally has no editing step.

## Source references

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Whisper small model](https://huggingface.co/Systran/faster-whisper-small)
- [Sherpa speaker recognition](https://k2-fsa.github.io/sherpa/onnx/speaker-identification/index.html)
- [OpenCV YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)
- [Gemini content API](https://ai.google.dev/api/generate-content)
- [OpenRouter free models](https://openrouter.ai/collections/free-models)

## Repository safety

API keys belong only in the app's Settings and Windows Credential Manager. Never put them in source files, environment files, screenshots, issues or commits. Models, working media, build outputs, local databases and private planning notes are excluded from Git. Run `npm run check:secrets` after staging changes; the optional pre-commit hook runs this same check. Pattern scanning is a safeguard, not a guarantee.

The installer is a build artifact, not a source file: keep it out of Git. See [security guidance](SECURITY.md) before sharing diagnostics or distributing a build.

## License and credits

Copyright **2026 Ayush Kant**. Original REELMIND source and branding are licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY.md) for bundled dependencies, models and fonts, whose licenses remain separate.
