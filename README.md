![REELMIND — Long videos. Strong moments.](assets/banner.svg)

<div align="center">

# REELMIND STUDIO
### A Personal, Local-First Instagram Reels & Anime AMV Studio for Windows

[![Release](https://img.shields.io/badge/Release-v0.3.1--prerelease-8b5cf6?style=for-the-badge&logo=github)](https://github.com/yushy07/reelmind/releases/tag/v0.3.1)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11%20(64--bit)-0078d4?style=for-the-badge&logo=windows)](https://github.com/yushy07/reelmind)
[![License](https://img.shields.io/badge/License-Apache%202.0-10b981?style=for-the-badge)](LICENSE)
[![Local First](https://img.shields.io/badge/Processing-100%25%20Offline%20Local-f43f5e?style=for-the-badge&logo=nvidia)](SECURITY.md)
[![UI](https://img.shields.io/badge/UI-Dark%20Glassmorphism-6366f1?style=for-the-badge)](src/styles/theme.css)

<p align="center">
  <a href="#-quick-download">Download Installer</a> •
  <a href="#-two-specialized-creative-studios">Two Dedicated Studios</a> •
  <a href="#-interactive-studio-workspace">Studio Workspace</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-build-from-source">Build from Source</a> •
  <a href="#-privacy--storage">Privacy & Security</a>
</p>

</div>

---

**REELMIND** is a personal, Windows-native desktop studio engineered to transform long-form content into viral, feed-ready vertical video (9:16). Whether distilling hour-long podcast conversations into punchy captioned Reels or decomposing 24-minute anime episodes into beat-synced AMVs, REELMIND executes visual intelligence, speech recognition, and video rendering **entirely on your local GPU/CPU**.

> **No cloud subscriptions. No timeline editing required. Your originals remain 100% untouched.**

---

## 📸 Interactive Studio Workspace

| 🎌 Anime AMV Studio (Beat-Synced 9:16 Edits) | 🎙️ Podcast Studio (Captioned Viral Reels) |
| :---: | :---: |
| ![Anime Studio Screen](docs/screenshots/anime-studio.png) | ![Podcast Studio Screen](docs/screenshots/podcast-studio.png) |

| 🚀 Rapid Project Ingestion | ⚙️ Offline Engine & Settings |
| :---: | :---: |
| ![New Project Ingestion](docs/screenshots/new-project.png) | ![Studio Settings](docs/screenshots/settings.png) |

---

## ⚡ Two Specialized Creative Studios

REELMIND features two dedicated creative workspaces switchable via the segmented studio tab:

### 🎙️ 1. Podcast Studio
*Designed for dialogue-driven conversations, interviews, presentations, and educational videos.*

- **Multilingual Whisper Recognition**: Native speech transcription using `faster-whisper` (Standard Whisper Small or optional Whisper Turbo) across English, Hindi/Hinglish, and Japanese.
- **Active-Speaker Face Tracking**: Powered by OpenCV YuNet neural face detection and Sherpa ONNX speaker embeddings to track speaking subjects and dynamically pan/frame them within vertical 9:16 boundaries.
- **Semantic Candidate Ranking**: MiniLM local vector embeddings compare candidate moments across the full video before selecting up to 12 distinct, high-retention clips.
- **Burned-in Animated Word Captions**: High-contrast, dynamic animated captions synced to precise word timestamps.
- **Optional Pasted Transcript**: Paste plain text or timed `.srt` / `.vtt` captions directly to bypass or assist speech recognition.

---

### 🎌 2. Anime Studio *(New in v0.3.0)*
*Engineered to turn 24-minute anime episodes and music tracks into rhythm-locked, high-energy 9:16 AMVs.*

- **Full Episode Ingestion**: Processes full 24-minute Japanese (original audio) or English dub episodes alongside any audio track (`.mp3`, `.wav`, `.flac`, `.aac`).
- **Scene & Shot Decomposition**: PySceneDetect + FFmpeg analyze shot transitions, content shifts, and camera cuts into a structured SQLite database.
- **Librosa Audio Beat-Grid Analysis**: Computes exact BPM, beat points, downbeats, and onset energy envelopes to align cuts strictly on musical beats.
- **Multi-Signal Visual Intelligence**:
  - Motion delta vectors (action intensity)
  - Laplacian visual sharpness scoring
  - Anime character face scoring with fallback isolation
  - Audio transient bursts and dialogue detection
- **$T_{\text{impact}}$ Climax Synchronization**: Detects peak visual impact frames within shots, aligning action climaxes directly to music beat drops instead of generic cut points.
- **3–5 Diverse AMV Concepts**: Synthesizes diverse concepts categorized into `Action`, `Emotional`, `Dialogue`, and `Cinematic` vibes with $\ge 2.5$s temporal separation.
- **Dynamic 9:16 Character-Centered Camera**: Tracks character bounds ($X \in [0.28, 0.72]$) with smooth panning, zoom punch-ins, and dual-stream background depth-of-field blur.
- **Neural Motion & Color Effects**: Velocity ramping curves with temporal frame blending (`tblend`), impact flash transitions, and shake dynamics.
- **In-Studio Interactive Controls**:
  - Edit Style Selector (`⚡ Hard Beat Drop`, `🚀 Velocity Ramp`, `🌌 Slow Burn`, `💬 Dialogue Pause`)
  - Dual-Track Audio Mixer (Anime Voice & SFX % vs. Music Track %)
  - One-click instant re-rendering (~3–5s on local GPU).
- **VRAM Lifecycle Management**: Two-pass memory architecture ensures strict cleanup (`torch.cuda.empty_cache()` + `gc.collect()`), running smoothly on 4 GB / 6 GB GPUs (e.g., RTX 3050).

---

## 🎨 Professional Dark Glassmorphism Design System

The application interface is styled with a modular, modern desktop aesthetic:
- **Layered Obsidian Surfaces**: Deep dark canvas (`#09080e`) with ambient radial mesh illumination.
- **True Physical Glassmorphism**: Specular light highlights (`inset 0 1px 1px 0 rgba(255, 255, 255, 0.14)`), frosted background blurs (`backdrop-filter: blur(24px)`), and translucent border stems.
- **Studio Mode Theming**:
  - **Podcast Studio**: Amethyst & Electric Violet accents (`#a78bfa`, `#7c3aed`).
  - **Anime AMV Studio**: Cyberpunk Neon Crimson (`#f43f5e`) & Cyan rhythm highlights (`#06b6d4`).
- **Live Radar Activity Pulse**: Double-ring animated radar beacon in the header reflecting background render status.
- **Modular Component Architecture**: Independent, type-safe components (`Sidebar`, `Header`, `Overview`, `NewProjectPodcast`, `NewProjectAnime`, `ProjectDetail`, `AnimeReelCard`, `Library`, `SettingsView`).

---

## 🚀 Quick Download

1. Download **`REELMIND.Setup.0.3.1.exe`** from the [v0.3.1 Release](https://github.com/yushy07/reelmind/releases/tag/v0.3.1).
2. Run the installer (NSIS single-installer bundled with local engine, models, and FFmpeg).
3. Launch **REELMIND** from your Start menu or desktop shortcut.
4. Drop your video, choose your studio mode, and let your workstation do the heavy lifting!

> *Note:* The prerelease installer is unsigned. On Windows SmartScreen, click **More info** $\to$ **Run anyway**.

---

## 🔄 How Media Becomes Reels

```mermaid
flowchart LR
    A[Source Media<br/>Local Video or URL] --> B[Private Project Workspace]
    B --> C[Media Probe & Audio Extraction]
    C --> D{Studio Mode}
    
    D -->|Podcast Studio| E1[Whisper Speech Recognition]
    E1 --> E2[Face Tracking & Speaker ONNX]
    E2 --> E3[MiniLM Semantic Clip Ranking]
    E3 --> G1[Edit Plans: 9:16 Framing & Captions]
    
    D -->|Anime AMV Studio| F1[PySceneDetect Shot Decomposition]
    F1 --> F2[Librosa Beat Grid & Energy Analysis]
    F2 --> F3[Multi-Signal Impact Scoring]
    F3 --> F4[3–5 Diverse AMV Concepts]
    F4 --> G2[Beat-Aligned Cuts & Neural Effects]
    
    G1 --> H[FFmpeg GPU / NVENC Render]
    G2 --> H
    H --> I[Interactive Video Player]
    I --> J[Save to External Folder]
    
    B -. 24h Expiry .-> K[Automatic Scratch Cleanup]
```

---

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph Frontend["Desktop UI (React 19 + TypeScript + Vite)"]
        UI[Modular Studio UI]
        Theme[Glassmorphism Theme System]
        Controls[Interactive Mixer & Style Switcher]
    end

    subgraph MainProcess["Electron Main & IPC Boundary"]
        IPC[Validated IPC Bridge]
        Service[Job Service & Checkpoint Queue]
        Store[(SQLite Database)]
    end

    subgraph Engine["Local Python AI & Worker Runtime"]
        Whisper[faster-whisper / Silero VAD]
        Vision[OpenCV YuNet Face Tracking]
        AnimeWorker[anime_worker.py: Librosa + PySceneDetect]
        Scorer[Multi-Signal Impact & Transient Math]
    end

    subgraph MediaTools["Hardware & Rendering"]
        FFmpeg[FFmpeg with NVENC GPU Acceleration]
        FFprobe[FFprobe Media Inspection]
    end

    subgraph CloudOpt["Optional Cloud Evaluation (Free-tier Only)"]
        Gemini[Google Gemini API]
        Router[OpenRouter Free Tier]
        LocalHeuristic[Offline Local Heuristics Fallback]
    end

    UI <-->|IPC| IPC
    IPC <--> Service
    Service <--> Store
    Service --> Engine
    Service --> MediaTools
    Service --> CloudOpt
```

### Key Source Structure

```text
REELMIND
├── src/
│   ├── components/            # Modular studio components
│   │   ├── Sidebar.tsx        # Glassmorphic sidebar with mode switcher & GPU status
│   │   ├── Header.tsx         # Floating header with breadcrumbs & radar beacon
│   │   ├── Overview.tsx       # Studio dashboard with hero banner & active queue
│   │   ├── NewProjectPodcast.tsx  # Podcast Reels creation wizard
│   │   ├── NewProjectAnime.tsx    # Anime AMV creation wizard
│   │   ├── ProjectDetail.tsx  # Workspace with pipeline progress & results
│   │   ├── AnimeReelCard.tsx  # AMV player with audio mixer & style pills
│   │   ├── Library.tsx        # Searchable project repository
│   │   └── SettingsView.tsx   # Local engines, hardware, and render settings
│   ├── styles/
│   │   ├── theme.css          # Design system tokens, glassmorphism, animations
│   │   └── components.css     # Component styling and layout rules
│   ├── main.tsx               # Application entry point and IPC orchestration
│   └── TranscriptionSettings.tsx # Whisper model downloader & accuracy toggle
├── electron/
│   ├── anime/                 # Anime AMV edit planner, selection, & renderer
│   ├── main.ts                # Electron window, security sandbox, and protocols
│   ├── service.ts             # Pipeline execution, job checkpoints, and recovery
│   └── storage.ts             # SQLite persistence layer
├── workers/
│   ├── worker.py              # Podcast transcription & speaker diarization
│   └── anime_worker.py        # PySceneDetect, Librosa beat-sync, and impact scoring
├── tests/                     # 62 unit and integration tests (100% passing)
└── docs/                      # Documentation and screenshots
```

---

## 🔒 Privacy & Storage

| Resource | Retention & Handling |
| :--- | :--- |
| **Original Media** | Never modified, moved, or deleted. Always read-only. |
| **Project Workspace** | Stored in private app data. Working scratch files expire 24 hours after completion or pause. |
| **Interrupted Jobs** | State checkpointed after every stage. Resumable within the 24-hour recovery window. |
| **Finished Reels / AMVs** | Retained in managed storage until you explicitly delete them or export them. |
| **Exported Videos** | Verified before internal copies are purged; never targeted by automatic cleanup. |
| **API Credentials** | Saved securely in **Windows Credential Manager**. Never written to Git or SQLite. |

---

## 💻 Build from Source

### Prerequisites
- **Windows 10 / 11 64-bit**
- **Node.js 24+**
- **Git**
- ~2 GB disk space for offline models, portable Python runtime, and FFmpeg tools.

```powershell
# 1. Clone repository
git clone https://github.com/yushy07/reelmind.git
cd reelmind

# 2. Install dependencies
npm ci

# 3. Setup portable offline AI runtime & models
npm run setup:runtime

# 4. Compile TypeScript & build bundle
npm run build

# 5. Launch desktop development application
npm start
```

### Verification & Testing
```powershell
# Run the 62 integration and unit tests
npm test

# Verify type safety
npm run typecheck

# Check for accidental credential leaks
npm run check:secrets

# Package NSIS Windows Setup Installer
npm run package
```

---

## 📜 License & Credits

Copyright **2026 Ayush Kant**. 

Licensed under the **[Apache License 2.0](LICENSE)**. Bundled third-party binaries, libraries, and open-source models (faster-whisper, Librosa, PySceneDetect, FFmpeg, Silero, Sherpa ONNX, OpenCV) retain their respective upstream licenses. See [NOTICE](NOTICE), [THIRD_PARTY.md](THIRD_PARTY.md), and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for full attribution.
