import React, { useState } from 'react';
import { Upload, Check, Music, Languages, Film, Sparkles, LoaderCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import type { AnimeCreateInput } from '../../shared/types';

interface NewProjectAnimeProps {
  ready: boolean;
  busy: boolean;
  settings: () => void;
  onCreate: (input: AnimeCreateInput) => void;
  pickVideo: () => Promise<string | null>;
  pickAudio: () => Promise<string | null>;
}

export function NewProjectAnime({
  ready,
  busy,
  settings,
  onCreate,
  pickVideo,
  pickAudio,
}: NewProjectAnimeProps) {
  const [episode, setEpisode] = useState('');
  const [music, setMusic] = useState('');
  const [lang, setLang] = useState<'ja' | 'en'>('ja');
  const [aspect, setAspect] = useState<'9:16' | '1:1' | '16:9'>('9:16');
  const [name, setName] = useState('');

  const episodeName = episode ? episode.split(/[\\/]/).pop() : '';
  const musicName = music ? music.split(/[\\/]/).pop() : '';

  return (
    <div className="narrow new-project-page">
      <div className="eyebrow eyebrow-anime">
        ANIME AMV STUDIO
      </div>
      <h1>Import episode & music.</h1>
      <p className="intro">
        Feed a full 24-minute anime episode and an audio track. REELMIND will decompose shots, map the musical rhythm grid, detect high-energy moments, and synthesize synchronized 9:16 AMVs.
      </p>

      <div className="panel import-panel panel-strong">
        {/* Step 1: Anime Episode */}
        <div className="form-step">
          <span className="badge-anime">01</span>
          <strong>Anime Episode Video</strong>
          <small>Required</small>
        </div>
        <button
          type="button"
          className={`file-zone ${episode ? 'has-file' : ''}`}
          onClick={async () => {
            const file = await pickVideo();
            if (file) setEpisode(file);
          }}
        >
          <span
            className={`upload-icon ${episode ? '' : 'icon-anime-soft'}`}
          >
            {episode ? <Check size={26} /> : <Film size={26} />}
          </span>
          <span className="file-zone-copy">
            <strong>{episodeName || 'Select anime episode from your computer'}</strong>
            <small>
              {episode
                ? 'Click to choose a different video'
                : 'Full episode in MP4, MKV, MOV, or WebM format'}
            </small>
          </span>
          <span className="secondary">{episode ? 'Change Video' : 'Browse Episode'}</span>
        </button>

        {/* Step 2: Music Track */}
        <div className="form-step">
          <span className="badge-anime">02</span>
          <strong>AMV Music Track</strong>
          <small>Required</small>
        </div>
        <button
          type="button"
          className={`file-zone ${music ? 'has-file' : ''}`}
          onClick={async () => {
            const file = await pickAudio();
            if (file) setMusic(file);
          }}
        >
          <span
            className={`upload-icon ${music ? '' : 'icon-music-fallback'}`}
          >
            {music ? <Check size={26} /> : <Music size={26} />}
          </span>
          <span className="file-zone-copy">
            <strong>{musicName || 'Select music track for rhythm beat-sync'}</strong>
            <small>
              {music
                ? 'Click to choose a different audio track'
                : 'MP3, WAV, AAC, FLAC, M4A, or OGG'}
            </small>
          </span>
          <span className="secondary">{music ? 'Change Audio' : 'Browse Audio'}</span>
        </button>

        {/* Step 3: Dialogue Language */}
        <div className="form-step">
          <span className="badge-anime">03</span>
          <strong>Episode Dialogue Language</strong>
          <small>Required</small>
        </div>
        <div className="language-selector">
          <button
            type="button"
            className={`language-btn ${lang === 'ja' ? 'active' : ''}`}
            onClick={() => setLang('ja')}
          >
            <Languages size={17} />
            🇯🇵 Japanese (Original Audio)
          </button>
          <button
            type="button"
            className={`language-btn ${lang === 'en' ? 'active' : ''}`}
            onClick={() => setLang('en')}
          >
            <Languages size={17} />
            🇺🇸 English Dub
          </button>
        </div>

        {/* Step 4: Output Aspect Ratio */}
        <div className="form-step">
          <span className="badge-anime">04</span>
          <strong>Output Aspect Ratio</strong>
          <small>Select Format</small>
        </div>
        <div className="language-selector">
          <button
            type="button"
            className={`language-btn ${aspect === '9:16' ? 'active' : ''}`}
            onClick={() => setAspect('9:16')}
          >
            📱 9:16 Vertical (Reels / TikTok)
          </button>
          <button
            type="button"
            className={`language-btn ${aspect === '1:1' ? 'active' : ''}`}
            onClick={() => setAspect('1:1')}
          >
            ⏹ 1:1 Square (Feed)
          </button>
          <button
            type="button"
            className={`language-btn ${aspect === '16:9' ? 'active' : ''}`}
            onClick={() => setAspect('16:9')}
          >
            🖥 16:9 Cinema (YouTube)
          </button>
        </div>

        <label className="project-name-field">
          PROJECT TITLE <span>OPTIONAL</span>
          <input
            maxLength={80}
            placeholder="e.g. Episode 04 Fight Sequence AMV"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <small>Leave blank to auto-name based on the episode file.</small>
        </label>

        {/* Intelligence Feature Summary */}
        <div className="import-summary">
          <span>
            <Film size={15} /> Shot Decomposition
          </span>
          <span>
            <Music size={15} /> Librosa Beat Grid
          </span>
          <span>
            <Languages size={15} /> Whisper ({lang.toUpperCase()})
          </span>
          <span>
            <span className="aspect-badge">
              {aspect === '9:16' ? '9:16 Vertical' : aspect === '1:1' ? '1:1 Square' : '16:9 Cinema'}
            </span>
          </span>
        </div>

        {!ready ? (
          <button className="primary full" onClick={settings}>
            Set Up Local Engine First <ArrowRight size={17} />
          </button>
        ) : (
          <button
            className="primary full btn-anime-primary"
            disabled={!episode || !music || busy}
            onClick={() =>
              onCreate({
                kind: 'local',
                episodePath: episode,
                musicPath: music,
                language: lang,
                name: name.trim() || undefined,
                outputAspect: aspect,
              })
            }
          >
            {busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
            Analyze Episode & Synthesize AMVs <ArrowRight size={17} />
          </button>
        )}
      </div>

      <p className="privacy">
        <ShieldCheck size={15} />
        Local analysis only. Original media files remain untouched on your disk.
      </p>
    </div>
  );
}
