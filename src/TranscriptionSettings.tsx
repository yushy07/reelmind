import React, { useState } from 'react';
import { Languages, Download, Pause, LoaderCircle, AlertCircle } from 'lucide-react';
import type { Settings, Status } from '../shared/types';

interface TranscriptionSettingsProps {
  data: Status;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function TranscriptionSettings({ data, settings, onChange }: TranscriptionSettingsProps) {
  const [error, setError] = useState('');
  const model = data.turbo;

  const act = async (action: 'download' | 'cancel') => {
    setError('');
    try {
      await window.reelmind!.turbo(action);
    } catch {
      setError('Unable to start the model download. Please retry.');
    }
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>
          <Languages size={20} /> Local Speech Recognition
        </h2>
        <span className={`badge ${model.ready ? 'completed' : 'paused'}`}>
          {model.ready ? 'Turbo Model Ready' : 'Standard Whisper Small'}
        </span>
      </div>

      <label>
        ACCURACY SELECTION
        <select
          value={settings.transcriptionMode || 'standard'}
          onChange={(e) =>
            onChange({
              ...settings,
              transcriptionMode: e.target.value as 'standard' | 'turbo',
            })
          }
        >
          <option value="standard">Standard — Whisper small (Fast & lightweight)</option>
          <option value="turbo" disabled={!model.ready}>
            Higher accuracy — Whisper turbo {!model.ready ? '(download required)' : ''}
          </option>
        </select>
      </label>

      <p className="utility-spaced">
        Standard Whisper runs quickly and reliably. Whisper Turbo delivers enhanced word-level precision on complex dialogue and terminology.
      </p>

      {model.message && (
        <p role="status" className="status-secondary">
          {model.message}
        </p>
      )}

      {!model.ready && (
        <div className="utility-spaced-sm">
          <small className="block mono-muted">
            Model Size: {(model.total / 1e9).toFixed(2)} GB · Available Space: {(model.freeBytes / 1e9).toFixed(1)} GB. Installed speech models never expire.
          </small>

          {model.running ? (
            <div className="progress-wrap">
              <progress
                aria-label="Turbo download progress"
                value={model.downloaded}
                max={model.total}
              />
              <div
                className="progress-row"
              >
                <span className="progress-pct">
                  {Math.floor((model.downloaded / model.total) * 100)}% downloaded
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => act('cancel')}
                >
                  <Pause size={14} /> Pause Download
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="secondary utility-spaced"
              onClick={() => act('download')}
            >
              <Download size={14} /> Download / Resume Whisper Turbo
            </button>
          )}
        </div>
      )}

      {(error || model.error) && (
        <div className="alert utility-spaced-sm" role="alert">
          <AlertCircle size={16} />
          <span>{error || model.error}</span>
        </div>
      )}

      <small className="block mono-subtle utility-spaced">
        If Turbo fails or runs out of resources, Whisper Small automatically takes over.
      </small>
    </section>
  );
}
