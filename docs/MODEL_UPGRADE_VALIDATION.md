# MiniLM + Whisper Turbo validation

## Implemented

- Pinned MiniLM quantized AVX2 model and tokenizer, verified SHA-256 downloads.
- Local CPU ONNX inference, masked mean pooling, normalized 384-dimensional vectors, complete text coverage through 128-token windows.
- Whole-video pool up to 96 before semantic deduplication and the final 12-clip ceiling; text deduplication on inference failure.
- Optional pinned Turbo download, partial-range resume, checksum validation, atomic promotion, disk-space checks and offline installed-model verification.
- Standard remains default. Jobs snapshot requested model/revision and retain effective small fallback on resume. Cancelling work does not trigger fallback.
- Settings download state, pause/retry, taskbar progress, project fallback messages, model storage separate from project cleanup.
- Transcript dependencies invalidate downstream checkpoints; render plans have identity checks before reusing outputs.
- New Project accepts optional pasted plain text or SRT/VTT cues. Timestamped cue boundaries are retained and token timings are estimated within each cue; plain text is distributed across the video duration. Pasted text is held in the private project workspace, not SQLite, and expires under the normal project cleanup rule. Leaving the field blank uses Whisper as before.
- README now distinguishes the locally installed v0.2.0 build from the latest published v0.1.1 installer and explains paste timing/privacy behavior.

## Verified on this Windows machine

- All 36 automated tests and TypeScript checks pass.
- Desktop bridge, home, import and transcription settings smoke checks.
- Packaged v0.2.0 startup self-test and actual MiniLM inference using the packaged Python/runtime: two 384-dimensional embeddings.
- Windows Setup EXE built (873,714,549 bytes). Turbo weights are not inside it.
- Setup installed successfully (exit 0); installed binary and uninstall registration report 0.2.0. Desktop shortcut replaced with the installed executable and correct icon. Start menu entry remains available.
- Native Windows UI check: installed home screen opens, local engine is Ready, Standard is selected, Turbo download controls are present, and credential-presence indicators remain intact. No keys were displayed or changed.
- Closing and reopening the installed app succeeds. Its `app.asar` SHA-256 matches the tested unpacked build. Git-history API-key pattern scan returned no matches.
- Real 1.62 GB Turbo download completed and passed all pinned file checksums after resuming network interruptions. CPU INT8 transcription on the local speech fixture produced three segments.
- User-supplied cricket commentary excerpt: decoded duration 54.9935 seconds. Standard produced 16 segments / 115 words; Turbo produced 13 segments / 120 words. Both detected English and had zero invalid word intervals (negative start, nonpositive interval or end outside audio tolerance). Turbo CPU run took 309.4 seconds. This is a functional timing check, not a human-scored accuracy benchmark; names still need review. A comparable Standard wall-time measurement was not captured.
- Real MiniLM inference: identical 1.0000, English paraphrase 0.8917, Hindi equivalent 0.9254, Japanese equivalent 0.9366, unrelated topic -0.0483. Threshold 0.88 is conservative, not a general quality guarantee.
- Long input windowing and distinct same-topic stories smoke checks.
- Full Standard local pipeline: two rendered Reels, unchanged original and verified external saves. This run used software H.264; it is not evidence of NVENC performance.
- Separate render smoke test requested NVENC and produced a 32-second 1080×1920 H.264/AAC, 30 FPS Reel with multilingual captions. The render helper can fall back automatically, so this result alone does not prove the encoder used.
- Model download unit scenarios: verified offline reopening, partial range resume, bad checksum, invalid range and cancellation.
- Turbo crash fallback, user cancellation, resumed fallback, job mode snapshots, checkpoint dependency invalidation and existing 24-hour lifecycle tests.

## Release gates still in progress

- Real Hindi/Hinglish, Japanese and mixed-language transcription evaluation. The supplied cricket highlights video is tagged English, not a multilingual benchmark. The semantic text smoke check above does not substitute for speech/caption evaluation.

The installed local app is updated to 0.2.0; public 0.2.0 release publication remains deferred until the language evaluation gate is satisfied. Existing v0.1.0 and v0.1.1 downloads are untouched.

No accuracy improvement or transcription speed claim should be made without a measured comparison. Existing public installers remain available while the new release is validated.
