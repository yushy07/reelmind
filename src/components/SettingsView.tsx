import React, { useState } from 'react';
import {
  Cpu,
  Monitor,
  Download,
  LoaderCircle,
  Sparkles,
  ShieldCheck,
  Check,
  KeyRound,
  Eye,
  EyeOff,
  Sliders,
} from 'lucide-react';
import type { Status, Settings, Provider } from '../../shared/types';
import { TranscriptionSettings } from '../TranscriptionSettings';

interface SettingsViewProps {
  data: Status;
  busy: boolean;
  save: (settings: Settings, keys: Partial<Record<Provider, string>>) => void;
  setup: () => void;
}

export function SettingsView({ data, busy, save, setup }: SettingsViewProps) {
  const [s, setS] = useState<Settings>(data.settings);
  const [keys, setKeys] = useState<Partial<Record<Provider, string>>>({});
  const [showKey, setShowKey] = useState<Record<Provider, boolean>>({
    gemini: false,
    openrouter: false,
  });

  return (
    <div className="narrow settings">
      <div className="eyebrow">STUDIO CONFIGURATION</div>
      <h1>Preferences & Engines.</h1>
      <p className="intro">
        Configure your local offline AI processing engines, hardware acceleration, and optional cloud intelligence.
      </p>

      {/* 1. Local Processing Engine */}
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Cpu size={20} /> Local Processing Engine
          </h2>
          <span className={`badge ${data.runtime.ready ? 'completed' : 'paused'}`}>
            {data.runtime.ready ? 'Engine Ready' : 'Setup Needed'}
          </span>
        </div>
        <p>
          Whisper speech recognition, character reframing, Librosa audio rhythm mapping, and font rendering execute natively on your GPU/CPU.
        </p>

        <div className="hardware">
          <Monitor size={18} />
          <span>{data.hardware || 'Detecting hardware acceleration…'}</span>
        </div>

        {!data.runtime.ready && (
          <div style={{ marginTop: 16 }}>
            <button
              className="primary"
              disabled={data.setup.running || busy}
              onClick={setup}
            >
              {data.setup.running ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Download size={16} />
              )}
              Download Local AI Engine (~1.5 GB)
            </button>
            <small className="block">
              One-time setup download: Speech models, PyTorch runtime, and multilingual fonts. Internet is only required during this download.
            </small>
          </div>
        )}

        {data.setup.message && (
          <p role="status" style={{ marginTop: 12, color: 'var(--text-secondary)' }}>
            {data.setup.message}
          </p>
        )}
        {data.setup.error && <div className="alert">{data.setup.error}</div>}
      </section>

      {/* 2. Optional Cloud Intelligence */}
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Sparkles size={20} /> Cloud Intelligence (Optional)
          </h2>
          <label className="switch">
            <input
              type="checkbox"
              checked={s.cloudEnabled}
              onChange={(e) => setS({ ...s, cloudEnabled: e.target.checked })}
            />
            <span>Enabled</span>
          </label>
        </div>
        <p>
          When enabled, only anonymized transcript text is evaluated for high-energy moment ranking. If unavailable or disabled, 100% offline local analysis takes over automatically.
        </p>

        <label style={{ marginTop: 20 }}>
          PROVIDER PRIORITY
          <select
            value={s.providerOrder[0]}
            onChange={(e) =>
              setS({
                ...s,
                providerOrder:
                  e.target.value === 'gemini'
                    ? ['gemini', 'openrouter']
                    : ['openrouter', 'gemini'],
              })
            }
          >
            <option value="gemini">Gemini (Default) → OpenRouter → Offline Local</option>
            <option value="openrouter">OpenRouter → Gemini → Offline Local</option>
          </select>
        </label>

        {(['gemini', 'openrouter'] as const).map((p) => (
          <div className="provider-fields" key={p} style={{ marginTop: 16 }}>
            <label>
              {p === 'gemini' ? 'GOOGLE GEMINI API KEY' : 'OPENROUTER API KEY'}
              <span>{data.keys[p] ? '● Key Securely Saved' : '○ Not Connected'}</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showKey[p] ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder={data.keys[p] ? 'Leave blank to preserve saved key' : 'Paste your API key here'}
                  value={keys[p] ?? ''}
                  onChange={(e) => setKeys({ ...keys, [p]: e.target.value })}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey({ ...showKey, [p]: !showKey[p] })}
                  style={{
                    position: 'absolute',
                    right: 12,
                    color: 'var(--text-muted)',
                    background: 'none',
                    border: 'none',
                  }}
                  title={showKey[p] ? 'Hide Key' : 'Show Key'}
                >
                  {showKey[p] ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <label style={{ marginTop: 10 }}>
              MODEL IDENTIFIER
              <input
                value={p === 'gemini' ? s.geminiModel : s.openrouterModel}
                onChange={(e) =>
                  setS({
                    ...s,
                    [p === 'gemini' ? 'geminiModel' : 'openrouterModel']: e.target.value,
                  })
                }
              />
            </label>

            {data.keys[p] && (
              <button
                type="button"
                className="text-button"
                onClick={() => setKeys({ ...keys, [p]: '' })}
                style={{ marginTop: 8 }}
              >
                Mark saved key for removal
              </button>
            )}
          </div>
        ))}

        <label className="check-line" style={{ marginTop: 18 }}>
          <input
            type="checkbox"
            checked={s.geminiFreeConfirmed}
            onChange={(e) => setS({ ...s, geminiFreeConfirmed: e.target.checked })}
          />
          <span>I confirm I use a billing-free project tier. REELMIND will never incur unwanted API charges.</span>
        </label>

        <p className="privacy">
          <ShieldCheck size={14} />
          Keys are stored in Windows Credential Manager. OpenRouter accepts free models only.
        </p>
      </section>

      {/* 3. Transcription Settings */}
      <TranscriptionSettings data={data} settings={s} onChange={setS} />

      {/* 4. Export & Render Specs */}
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Sliders size={20} /> Export & Render Settings
          </h2>
          <span className="badge">1080 × 1920 (9:16)</span>
        </div>
        <label>
          VIDEO ENCODING QUALITY
          <select
            value={s.quality}
            onChange={(e) => setS({ ...s, quality: e.target.value as Settings['quality'] })}
          >
            <option value="balanced">Balanced — Faster render, smaller file size</option>
            <option value="high">High — Maximum visual fidelity (slower render)</option>
          </select>
        </label>
        <p style={{ marginTop: 12 }}>
          Standard render: 30/60 FPS, H.264 video with source audio or rhythm-mixed AMV track. Scratch files expire after 24 hours. Finished Reels remain available until deleted.
        </p>
      </section>

      {/* Save Button */}
      <button className="primary" disabled={busy} onClick={() => save(s, keys)}>
        <Check size={17} /> Save Studio Preferences
      </button>
    </div>
  );
}
