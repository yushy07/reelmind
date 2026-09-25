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
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string>('');
  const [telemetry, setTelemetry] = useState<any>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);

  const loadDiagnostics = async () => {
    setLoadingDiag(true);
    try {
      const report = await window.reelmind?.gpuDiagnostics?.();
      const telem = await window.reelmind?.gpuTelemetry?.();
      if (report) setDiagnostics(report);
      if (telem) setTelemetry(telem);
    } catch {}
    setLoadingDiag(false);
    setDiagOpen(true);
  };

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

        <div className="hardware" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Monitor size={18} />
            <span>{data.hardware || 'Detecting hardware acceleration…'}</span>
          </div>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer' }}
            onClick={loadDiagnostics}
            disabled={loadingDiag}
          >
            {loadingDiag ? 'Probing GPU…' : (diagOpen ? 'Refresh Diagnostics' : 'Inspect RTX 3050')}
          </button>
        </div>

        {diagOpen && diagnostics && (
          <div style={{ marginTop: '12px', padding: '12px', background: '#18181b', color: '#e4e4e7', borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace', overflowX: 'auto', border: '1px solid #27272a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #3f3f46', paddingBottom: '4px' }}>
              <span style={{ fontWeight: 'bold', color: '#4ade80' }}>● REAL-TIME GPU DIAGNOSTICS</span>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: '11px' }}
                onClick={() => setDiagOpen(false)}
              >
                ✕ Close
              </button>
            </div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>{diagnostics}</pre>
            {telemetry && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #3f3f46', color: '#93c5fd', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <span>GPU: {telemetry.gpuUtilPct}%</span>
                <span>NVENC: {telemetry.encoderUtilPct}%</span>
                <span>NVDEC: {telemetry.decoderUtilPct}%</span>
                <span>VRAM: {telemetry.vramUsedMb} MB / {telemetry.vramTotalMb} MB</span>
                <span>Temp: {telemetry.temperatureC}°C</span>
              </div>
            )}
          </div>
        )}

        {!data.runtime.ready && (
          <div className="settings-gap">
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
          <p role="status" className="settings-status status-secondary">
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

        <label className="settings-label-gap">
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
          <div className="provider-fields field-spaced" key={p}>
            <label>
              {p === 'gemini' ? 'GOOGLE GEMINI API KEY' : 'OPENROUTER API KEY'}
              <span>{data.keys[p] ? '● Key Securely Saved' : '○ Not Connected'}</span>
              <div className="inline-field">
                <input
                  type={showKey[p] ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder={data.keys[p] ? 'Leave blank to preserve saved key' : 'Paste your API key here'}
                  value={keys[p] ?? ''}
                  onChange={(e) => setKeys({ ...keys, [p]: e.target.value })}
                  className="input-padded"
                />
                <button
                  type="button"
                  onClick={() => setShowKey({ ...showKey, [p]: !showKey[p] })}
                  className="icon-btn-plain"
                  title={showKey[p] ? 'Hide Key' : 'Show Key'}
                >
                  {showKey[p] ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <label className="field-spaced-sm">
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
                className="text-button utility-spaced-sm"
                onClick={() => setKeys({ ...keys, [p]: '' })}
              >
                Mark saved key for removal
              </button>
            )}
          </div>
        ))}

        {(data.keys.gemini || (keys.gemini && keys.gemini.trim().length > 0)) && !s.geminiFreeConfirmed && (
          <div className="alert alert-banner field-spaced-sm">
            <span>Please confirm that your Gemini project is on a free tier below. REELMIND requires this confirmation before using Gemini for moment ranking.</span>
          </div>
        )}

        <label className="check-line check-spaced">
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
        <p className="utility-spaced">
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
