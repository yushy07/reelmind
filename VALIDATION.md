# REELMIND V1 verification — 22 September 2026

## Verified on this Windows machine

- TypeScript check and production build succeed.
- 13 automated tests pass: input URLs, clip bounds/deduplication, free-model restrictions, quota fallback, malformed-response fallback, immediate network-error fallback, multilingual caption boundaries, plan timing, SQLite persistence, export/cleanup path boundaries, output retention and interrupted-job recovery.
- Real Electron app launches with its isolated preload bridge. Home, import and settings screens were captured and visually inspected.
- Packaged executable self-test loads the renderer, locates its bundled models, and imports faster-whisper, OpenCV and Sherpa ONNX from its embedded Python runtime.
- Local generated English speech video completed import, transcription, speaker/face analysis, local ranking, rendering and external saving. It produced one selected Reel. The original video hash remained unchanged and saved output was verified.
- Real synthetic caption export produced 1080×1920 H.264/AAC MP4. Hindi and Japanese glyphs were visually checked. Captions reset at sentence and Japanese-script boundaries.
- RTX 3050 NVIDIA H.264 encoding passed a separate 1080×1920 hardware test.
- Public YouTube metadata extraction succeeded for Blender Foundation's Big Buck Bunny video using the bundled Electron JavaScript runtime.
- A nonzero-start render verified fast input seeking with a 32-second 1080×1920 H.264/AAC output.
- Both user-supplied API credentials are stored in Windows Credential Manager. Read-only authentication checks returned HTTP 200 for Gemini and OpenRouter. OpenRouter reported a free-tier account, and a completion using `openrouter/free` returned HTTP 200.
- A credential-aware scan of source, test metadata and the packaged application found zero plaintext copies. No credential values are included in this document or installer. The user confirmed Gemini billing is disabled, and Gemini-first ordering is saved in the Windows app profile.
- Gemini model discovery returned its current Flash alias. The older fixed default returned HTTP 404 for generation; the Flash alias returned HTTP 503 during the initial live generation check. The default now uses `gemini-flash-latest` and can fall back to OpenRouter and local analysis when unavailable.
- The live provider integration test attempted Gemini and OpenRouter on the generated speech transcript. The cloud responses were not usable for selection; local fallback completed with one candidate whose duration was valid. This verifies recovery, not successful cloud editorial analysis.
- npm reported no dependency vulnerabilities after updating Electron; production dependency audit also reports zero.

## Code signing & packaging

- `package.json` specifies `signtoolOptions.publisherName: "Ayush Kant"` and `requestedExecutionLevel: "asInvoker"` for standard user permission execution without administrative elevation prompts.
- Production builds strip esbuild sourcemaps using `npm run build:packaged` (`--packaged` argument) to prevent internal source directory paths from leaking in `dist-electron/main.cjs`.
- For release signing, see `docs/signing.md`. CI/packaging environments should supply `CSC_LINK` and `CSC_KEY_PASSWORD` (or configure a hardware token / Azure Trusted Signing) prior to invoking `electron-builder --win nsis`.
- Sideloaded or ad-hoc builds during development remain unsigned; users may verify the installer using `Get-FileHash release/*.exe -Algorithm SHA256`.

## Not yet verified

- Live Gemini generation and cloud ranking of an actual podcast. Authentication and an OpenRouter free completion pass; fallback behavior is additionally tested with controlled API responses.
- Full YouTube download and processing of a real podcast. Public metadata extraction passes; downloader cache is kept inside the job workspace.
- Human evaluation of clip selection, transcription and framing on real English/Hindi/Hinglish/Japanese podcasts, especially overlapping speakers and changing camera angles.
- A clean Windows installation on a different computer, installer upgrade/uninstall behavior, or a production-signed release (certificate configuration is documented in docs/signing.md).
- Clock rollback while the app is closed. Deadlines are persisted wall-clock timestamps; cleanup runs at startup and while the app is open.

These limits affect validation coverage and output quality; the local pipeline is implemented and exercised. Local ranking is heuristic rather than a local large language model. Rendering uses conservative silence removal and punch cuts; it is not equivalent to a human editor.

