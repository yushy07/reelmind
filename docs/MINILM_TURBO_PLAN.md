# REELMIND: MiniLM and optional Whisper Turbo

Original implementation plan · 23 September 2026.

> **Status:** The MiniLM and optional Whisper Turbo work is implemented in v0.2.0 and published as a personal-use prerelease. Real-language evaluation remains incomplete as listed in [MODEL_UPGRADE_VALIDATION.md](MODEL_UPGRADE_VALIDATION.md). This document preserves the original scope and acceptance plan; consult the validation report for current evidence.

## 1. Current build audit

The v0.1.1 Windows prerelease is published with its Setup EXE. v0.1.0 is still available. The current source includes project names, an in-progress/recovery project list, Windows taskbar progress, provider fallback messages, GPU-to-CPU speech fallback, and encoder fallback.

Verified during this audit:

- The existing 19 automated tests and TypeScript check pass.
- The packaged app self-test passes outside the restricted test runner: renderer, local runtime, and worker imports are ready.
- The source build and desktop smoke check pass for the bridge, Home, New Project, and Settings. The project-name input was visually checked in the captured app screen.
- An eight-second synthetic speech sample requested GPU transcription, fell back to CPU, and produced a valid transcript with three segments.
- Both published installers are present on GitHub. The source repository is separate from installer assets.

Audit findings:

- Fixed in source: leaving the project name blank previously locked a YouTube project to “Linked video.” Unnamed new projects now display the detected source title; custom names remain independent. The existing v0.1.1 installer predates this fix.
- GPU encoding uses NVENC when available. Full GPU speech inference is **not** available on this machine: CUDA model construction succeeded, but inference reported a missing cuBLAS library. CPU fallback was verified. Neither CPU video filters nor speaker/face analysis have become GPU workloads.
- The taskbar progress call is connected to active job updates and clears when no job is running. Its visual appearance on the Windows taskbar has not been manually verified in this audit.
- Real multilingual quality, Turbo performance, and a fresh full-video render/save run remain acceptance work. Synthetic tests are not evidence of speech accuracy or editorial quality.
- The release publisher currently replaces an existing asset with the same name. Before the next publication, make it refuse conflicting assets and reuse identical ones; existing releases must remain intact.

## 2. Locked scope and defaults

- Windows x64; personal use; no paid AI requirement.
- Whisper small remains the installed default and transcription fallback.
- MiniLM runs locally to remove semantically repetitive candidates. It does not score hooks, invent clips, translate captions, or replace Gemini → OpenRouter → local discovery.
- Whisper large-v3-turbo is optional, downloaded only after the user requests it, and initially runs on CPU INT8.
- Preserve source-language captions, word timestamps, source audio, 30–60-second exports, and a maximum of 12 clips. Fewer are valid.
- No pyannote, DeepFilterNet, Remotion, PaddleOCR, or NVIDIA-library bundling in this upgrade.
- Deliver one new Windows prerelease after the acceptance checks. Keep v0.1.0 and v0.1.1 available.

## 3. Model assets and runtime

| Model | Distribution | Use |
| --- | --- | --- |
| Whisper small | Existing installer bundle | Default transcription and recovery option |
| Multilingual MiniLM-L12-v2 | Bundle one quantized ONNX file plus tokenizer/configuration files | Candidate similarity on CPU |
| Whisper large-v3-turbo | Optional download into managed app data | User-selected transcription on CPU INT8 |

For Windows x64, start with `onnx/model_quint8_avx2.onnx`, rather than an ARM64 or AVX512-targeted variant. The upstream file listing gives about 118 MB for its weights; `tokenizer.json` adds about 9 MB. Allow for ONNX Runtime and small configuration/license files too: 118 MB is not the complete installer increase. Confirm the supported CPU baseline in a packaged inference test. If inference is unavailable on a machine, retain text-based deduplication. [MiniLM assets](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/main/onnx), [tokenizer files](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/main).

Use CPU `onnxruntime`, the existing `tokenizers` dependency, and NumPy in the local worker. Pin compatible versions. Avoid bringing PyTorch or the full Sentence Transformers stack into the installer just to run embeddings.

Create a model manifest in source with repository, immutable revision, approved filenames, exact byte sizes, SHA-256 values, license, and model/algorithm version. Download only manifest-listed files. Resolve and verify hashes during implementation; do not invent values or use a moving `main` reference for release downloads.

The Turbo repository contains FP16 weights that CTranslate2 can load using a selected compute type. Its model is approximately 1.62 GB, with tokenizer, vocabulary, and configuration files in addition. Bundle none of these Turbo files in Setup. [Turbo files](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/tree/main), [conversion details](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo).

## 4. Semantic clip selection

### Pipeline placement

```mermaid
flowchart LR
    A[Whole-video candidate discovery] --> B[Validate scores, timings and overlap]
    B --> C[Global candidate ranking]
    C --> D[MiniLM diversity pass]
    D --> E[Final selection: at most 12]
    D -. inference failure .-> F[Existing text similarity filter]
    F --> E
```

Refactor the current selection helpers so they do not permanently cut the candidate pool to 12 before semantic comparison. Keep a bounded pool, initially up to 96 high-quality non-overlapping candidates, drawn from the complete video. Finalize the 12-clip ceiling after semantic filtering. Use stable IDs for cloud ranking and retain canonical candidate content; model responses must not silently rewrite transcript-derived timestamps or wording.

For each candidate:

1. Extract transcript words within its source time range. Use actual spoken text, not generated hook/context summaries.
2. Tokenize locally with the bundled tokenizer. Respect the model's 128-token sequence limit, including special tokens. Divide longer clip text into consecutive sentence/token windows; never silently compare only the beginning of a clip. [Sequence configuration](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/blob/main/sentence_bert_config.json).
3. Run bounded CPU batches. Mean-pool token embeddings using the attention mask so padding contributes no weight. Aggregate long-clip windows by their content-token counts, then L2-normalize the final 384-dimensional vector. Reject empty, non-finite, zero-norm, or incorrectly shaped results. [Model and pooling guidance](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2).
4. Walk candidates from strongest to weakest. Compare each vector with already selected candidates using cosine similarity. Drop a substantially repeated idea and retain the stronger candidate.
5. Start evaluation around a conservative similarity threshold of 0.88, then calibrate it against labeled English, Hindi/Hinglish, Japanese, translation, and same-topic/different-story pairs. Do not ship an untested threshold as a universal guarantee.

Keep the quality threshold, word-boundary adjustments, duration checks, and time-overlap rejection. If embeddings fail, discard the incomplete semantic result, report the fallback, and run the existing text-similarity selection over the candidate pool. A user pause/cancel must stop work rather than trigger another fallback attempt.

Store embeddings only inside the project's temporary workspace. Cache identity includes the transcript hash, canonical candidate ranges, model revision, tokenizer revision, and pooling/selection version. Recompute dependent artifacts if any of those change.

## 5. Turbo choice and download experience

Settings gains a transcription selector:

- **Standard (Whisper small)** — installed and selected by default.
- **Higher accuracy (Whisper turbo)** — optional larger model; may be slower on CPU. Better accuracy is something to measure, not a promise for every recording.

Selecting an uninstalled Turbo model shows the expected download size, available disk space, and a Download action. Show Downloading, Verifying, Ready, Interrupted, and Failed states with progress and retry/cancel actions. Do not change the saved mode to Turbo until installation verifies successfully; cancelling leaves Standard selected.

Implement a model manager owned by the Electron background service:

1. Download only pinned public model assets; no provider API keys or Hugging Face login is required.
2. Check the remaining manifest size plus a safety margin against free space before starting and during transfer.
3. Stream into an app-owned staging directory using `.part` files. Never buffer the full model in memory.
4. Resume interrupted transfers only with a matching artifact identity and valid HTTP range response. If the server returns a full response, restart that file rather than appending corrupt bytes.
5. Verify every required file's size and SHA-256, parse configuration/tokenizer data, and run a short offline CPU load/inference check.
6. Promote the complete staged directory atomically on the same volume. Write the Ready marker last. An incomplete directory must never appear installed.
7. Keep download state across app restarts. Clear abandoned partial downloads after 24 hours of inactivity; a verified installed model does not expire. Keep a working older model available until a replacement verifies.

Keep integrity checks out of the UI's five-second status polling loop. Cache verified model state and revalidate at startup/first use or when file metadata changes.

## 6. Transcription, jobs, and recovery

Add a backward-compatible `transcriptionMode` setting with `standard` as its default. New jobs snapshot the requested mode and model revision when created. Old jobs without a mode are Standard. Later Settings changes affect only new jobs.

The worker receives an explicit verified local model path and device/compute configuration:

- Standard uses the existing small-model path and current GPU/CPU fallback policy.
- Turbo runs `device=cpu`, `compute_type=int8`, with bounded CPU threads. It must not accidentally inherit Standard's CUDA option.
- If Turbo cannot load or fails during inference, release the worker/model and retry the transcription stage once with Whisper small on CPU. Handle both Python errors and a crashed worker process in the service.
- Save both requested and effective model information. Show “Turbo unavailable — continuing with Standard” and retain that entry in the project's fallback history.
- A successful small-model fallback checkpoint is valid on resume; do not repeatedly retry broken Turbo on every restart. Cancellation is not a model failure.

Write the transcript atomically only after successful completion. Its checkpoint metadata records source/audio identity, requested/effective model, revision, language handling, and worker version. Invalidate framing, candidate, embedding, and render-plan checkpoints when their upstream transcript changes. Do not combine part of a Turbo transcript with part of a small-model transcript.

Keep current word timestamps and multilingual caption behavior. Preserve the existing progress bar and taskbar indicator, and add clear “Comparing candidate ideas” and model download/verification messages. Stage progress and labels must describe actual work.

## 7. Storage and readiness

| Location | Contents | Lifetime |
| --- | --- | --- |
| Packaged `resources/runtime/models/` | Whisper small and MiniLM | Installed app lifetime |
| Managed app data `models/whisper-turbo/<revision>/` | Verified optional Turbo model | Persists across projects and app restarts |
| Managed app data `model-downloads/` | Download state and partial files | Resume/retry; abandoned partials expire after 24 hours |
| Project `work/<id>/` | Source copy, audio, transcript, embeddings, analysis, plans | Existing 24-hour completion/interruption policy |
| Managed `outputs/<id>/` | Unsaved completed Reels | Retained until verified external saving or explicit deletion |

Project cleanup must only traverse that project's workspace and incomplete renders. It must never remove global models. Local source files and saved external Reels remain outside cleanup targets.

Split readiness into core processing readiness, semantic-model availability, and optional Turbo availability. A broken/missing MiniLM model degrades selection to text similarity; missing Turbo never blocks Standard. Packaging verification, however, must fail if the promised MiniLM bundle is missing or corrupt.

## 8. Delivery sequence

1. **Baseline and model contracts:** carry forward the naming fix; add settings/job defaults, manifest types, dependency fingerprints, and explicit per-feature readiness. Harden release publication against accidental replacement.
2. **MiniLM:** package the chosen ONNX/tokenizer assets, add local embeddings, refactor the candidate pool, and connect semantic deduplication plus text fallback.
3. **Turbo manager:** implement streamed verified downloads, managed model storage, restart recovery, and Settings states.
4. **Turbo execution:** snapshot job choices, run CPU INT8, add service-level small-model retry, and validate checkpoint invalidation and cleanup boundaries.
5. **Acceptance and release:** complete the checks below, refresh screenshots/docs/credits, build and test a new Setup EXE, then publish a new Windows prerelease.

Use separate reviewable commits for these stages and push after their checks pass. The next version number is selected from the release state at publication; do not replace a historical release asset.

## 9. Acceptance and release gates

### Automated checks

- Existing suite, TypeScript, production build, worker syntax, packaged launch, and staged secret scan.
- Candidate filtering preserves duration, quality, overlap, maximum count, and strongest-candidate retention.
- Identical text, paraphrases, translated ideas, different topics, and different stories about the same topic. Include long clips where the distinguishing idea comes after token 128.
- Padding-aware pooling, finite normalized vectors, embedding failure, corrupt model, and text-only fallback.
- Download interruption/range restart, hash mismatch, insufficient disk, cancellation, duplicate download requests, and offline installed-model loading.
- Standard default for old settings/jobs; mode snapshot on new jobs; resume with changed Settings; Turbo failure/worker crash retries Standard only once; user cancellation triggers no fallback.
- Expired project transcripts/embeddings are removed while installed models, original source files, saved Reels, and unsaved finished outputs survive.

### Real-media and Windows checks

Use the same real English, Hindi/Hinglish, Japanese, and mixed-language clips on v0.1.1 and the new build. Keep a small human-reviewed reference transcript and labeled candidate-pair set. Use user-provided or appropriately reusable samples; retain media outside Git.

Record wording errors, word-boundary timing, caption readability, clip diversity, elapsed transcription/render time, and peak memory. Turbo must produce correct-language timed transcripts on the target cases, and any claimed accuracy improvement must be supported by those comparisons. Do not label synthetic speech as real podcast evaluation.

Run a complete local video through selection, rendering, playback, and verified external save. Confirm Standard works offline with cloud disabled; after its one-time download, Turbo must work offline too. Visually check the new Settings flow, named/unnamed projects, fallback history, active-project list, and Windows taskbar progress/clearing.

### Publication

- Package only small + MiniLM; inspect the installer to ensure Turbo is excluded.
- Include the pinned model sources and their licenses in `THIRD_PARTY.md`, the generated inventory, and bundled notices.
- Check source history/staged files for credentials and media. Confirm the installer contains no personal profile, API keys, transcripts, or test recordings.
- Match the installer to its tested source commit and publish its SHA-256. Create the prerelease only after successful verification; preserve existing release assets.
- Update the README's download link and explain that GitHub source ZIPs require a development build, while Setup includes the normal app runtime.

## 10. Exit condition

The upgrade is complete when a clean Windows install can process locally with Standard, remove semantically repeated candidates, download Turbo on demand, continue through tested fallbacks, resume with the original job's mode, and save playable Reels externally. Publishing remains gated by real-media and Windows checks; the plan itself is not proof that those checks have passed.
