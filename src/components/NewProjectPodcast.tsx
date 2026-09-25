import React, { useState } from 'react';
import { Upload, Link2, Check, Languages, Film, Monitor, AudioLines, Sparkles, LoaderCircle, ArrowRight, ShieldCheck, ChevronRight } from 'lucide-react';
import type { CreateInput } from '../../shared/types';

interface NewProjectPodcastProps {
  ready: boolean;
  busy: boolean;
  settings: () => void;
  onCreate: (input: CreateInput) => void;
  pick: () => Promise<string | null>;
}

export function NewProjectPodcast({ ready, busy, settings, onCreate, pick }: NewProjectPodcastProps) {
  const [kind, setKind] = useState<'local' | 'url'>('local');
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [transcript, setTranscript] = useState('');

  const fileName = value ? value.split(/[\\/]/).pop() : '';

  return (
    <div className="narrow new-project-page">
      <div className="eyebrow">PODCAST HIGHLIGHTS STUDIO</div>
      <h1>Bring your video.</h1>
      <p className="intro">
        Drop in a conversation, interview, or lecture. REELMIND will find the highest-impact moments and format them into vertical Reels.
      </p>

      <div className="panel import-panel">
        {/* Step 1: Choose Source */}
        <div className="form-step">
          <span>01</span>
          <strong>Choose Source Video</strong>
          <small>Required</small>
        </div>

        <div className="tabs" role="tablist" aria-label="Video source">
          <button
            type="button"
            className={kind === 'local' ? 'active' : ''}
            aria-selected={kind === 'local'}
            onClick={() => {
              setKind('local');
              setValue('');
            }}
          >
            <Upload size={16} />
            Local Video File
          </button>
          <button
            type="button"
            className={kind === 'url' ? 'active' : ''}
            aria-selected={kind === 'url'}
            onClick={() => {
              setKind('url');
              setValue('');
            }}
          >
            <Link2 size={16} />
            Public Video URL
          </button>
        </div>

        {kind === 'local' ? (
          <button
            type="button"
            className={`file-zone ${value ? 'has-file' : ''}`}
            onClick={async () => {
              const file = await pick();
              if (file) setValue(file);
            }}
          >
            <span className="upload-icon">
              {value ? <Check size={26} /> : <Upload size={26} />}
            </span>
            <span className="file-zone-copy">
              <strong>{fileName || 'Select a video from your computer'}</strong>
              <small>
                {value ? 'Click to replace selected file' : 'Supports MP4, MOV, MKV, AVI, and WebM'}
              </small>
            </span>
            <span className="secondary">{value ? 'Change File' : 'Browse Files'}</span>
          </button>
        ) : (
          <label className="link-field">
            PUBLIC VIDEO LINK
            <input
              type="url"
              placeholder="https://youtube.com/watch?v=…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <small>Direct MP4 or YouTube public video links. Handled one at a time.</small>
          </label>
        )}

        <label className="project-name-field">
          PROJECT TITLE <span>OPTIONAL</span>
          <input
            maxLength={80}
            placeholder="e.g. Episode 42 Highlights"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <small>Defaults to the source video name if left blank.</small>
        </label>

        {/* Step 2: Transcript Drawer */}
        <div className="form-step">
          <span>02</span>
          <strong>Transcript & Captions</strong>
          <small>Optional</small>
        </div>

        <details className="transcript-disclosure">
          <summary>
            <span className="transcript-summary-icon">
              <Languages size={18} />
            </span>
            <span className="transcript-summary-copy">
              <strong>Paste Timed Transcript or Script</strong>
              <small>Plain text or timed SRT/VTT captions</small>
            </span>
            <span className={`transcript-state ${transcript.trim() ? 'added' : ''}`}>
              {transcript.trim() ? 'Custom Added' : 'Automatic Local'}
            </span>
            <ChevronRight className="disclosure-chevron" size={18} />
          </summary>
          <div className="transcript-paste">
            <label htmlFor="pasted-transcript">TRANSCRIPT CONTENT</label>
            <textarea
              id="pasted-transcript"
              rows={6}
              maxLength={200000}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Paste timed SRT, VTT, or plain conversation text here…"
            />
            <div className="transcript-help">
              <small>
                Leave empty to run local Whisper speech recognition on your computer.
              </small>
              <span>{transcript.length.toLocaleString()} / 200,000 characters</span>
            </div>
          </div>
        </details>

        {/* Output Specs Banner */}
        <div className="import-summary">
          <span>
            <Film size={15} /> Up to 12 Finished Reels
          </span>
          <span>
            <Monitor size={15} /> 1080 × 1920 (9:16)
          </span>
          <span>
            <AudioLines size={15} /> 30–60s Clips
          </span>
        </div>

        {!ready ? (
          <button className="primary full" onClick={settings}>
            Set Up Local Engine First <ArrowRight size={17} />
          </button>
        ) : (
          <button
            className="primary full"
            disabled={!value.trim() || busy}
            onClick={() =>
              onCreate({
                kind,
                value: value.trim(),
                name: name.trim() || undefined,
                pastedTranscript: transcript.trim() ? transcript : undefined,
              })
            }
          >
            {busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
            Generate Reels <ArrowRight size={17} />
          </button>
        )}
      </div>

      <p className="privacy">
        <ShieldCheck size={15} />
        Your original video stays untouched. Processing occurs 100% locally on your machine.
      </p>
    </div>
  );
}
