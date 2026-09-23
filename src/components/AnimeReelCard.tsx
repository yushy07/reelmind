import React, { useState } from 'react';
import { Sparkles, LoaderCircle, CheckCircle2, Music, Volume2 } from 'lucide-react';
import type { Job, AnimeEditStyle, AnimeRerenderOptions } from '../../shared/types';

interface AnimeReelCardProps {
  job: Job;
  reel: Job['outputs'][0];
  index: number;
  busy: boolean;
  onRerender: (conceptId: number, options: AnimeRerenderOptions) => Promise<void>;
}

const durationFormat = (seconds: number) => {
  const total = Math.round(Math.max(0, seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function AnimeReelCard({ job, reel, index, busy, onRerender }: AnimeReelCardProps) {
  const conceptId = parseInt(reel.id, 10);
  const concept = job.animeAnalysis?.concepts?.find((c) => c.id === conceptId);
  const [style, setStyle] = useState<AnimeEditStyle>(concept?.style || 'hard_beat_drop');
  const [sourceAudio, setSourceAudio] = useState(40);
  const [music, setMusic] = useState(100);
  const [localBusy, setLocalBusy] = useState(false);

  const handleRerender = async () => {
    if (localBusy || busy) return;
    setLocalBusy(true);
    try {
      await onRerender(conceptId, {
        style,
        sourceAudioMix: sourceAudio / 100,
        musicMix: music / 100,
      });
    } finally {
      setLocalBusy(false);
    }
  };

  const isWorking = localBusy || busy;

  return (
    <article className="anime-output-card" key={reel.id}>
      <video
        controls
        preload="metadata"
        key={reel.planHash || reel.id}
        src={`reel://output/${job.id}/${reel.id}?h=${reel.planHash || ''}`}
        aria-label={`AMV Edit ${index + 1}: ${reel.title}`}
      />
      <div className="anime-output-body">
        <div className="anime-output-meta">
          <span className="eyebrow">
            AMV {String(index + 1).padStart(2, '0')} <span>{durationFormat(reel.duration)}</span>
          </span>
          {concept && (
            <span className={`candidate-tag ${concept.category}`}>
              {concept.category.toUpperCase()}
            </span>
          )}
        </div>
        <h3 className="anime-output-title">{reel.title}</h3>
        {reel.reason && <p className="anime-output-reason">{reel.reason}</p>}

        {/* Studio Mixer Controls */}
        <div className="anime-studio-controls">
          <div className="anime-control-group">
            <div className="anime-control-header">
              <span>Edit Style</span>
              <strong>{style.replace(/_/g, ' ')}</strong>
            </div>
            <div className="style-pills-row">
              {(
                [
                  ['hard_beat_drop', '⚡ Hard Beat'],
                  ['velocity_ramp', '🚀 Velocity'],
                  ['slow_burn', '🌌 Slow Burn'],
                  ['dialogue_pause', '💬 Dialogue'],
                ] as const
              ).map(([val, name]) => (
                <button
                  type="button"
                  key={val}
                  className={`style-pill-btn ${style === val ? 'active' : ''}`}
                  onClick={() => setStyle(val)}
                  disabled={isWorking}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="anime-control-group">
            <div className="anime-control-header">
              <span>Audio Mixer</span>
              <small>
                {sourceAudio}% Voice / {music}% Music
              </small>
            </div>
            <div className="audio-sliders">
              <label className="slider-row">
                <div className="slider-row-labels">
                  <span>
                    <Volume2 size={12} style={{ display: 'inline', marginRight: 4 }} />
                    Voice & SFX
                  </span>
                  <strong>{sourceAudio}%</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={sourceAudio}
                  onChange={(e) => setSourceAudio(parseInt(e.target.value, 10))}
                  disabled={isWorking}
                  aria-label="Voice & SFX Mix"
                />
              </label>
              <label className="slider-row">
                <div className="slider-row-labels">
                  <span>
                    <Music size={12} style={{ display: 'inline', marginRight: 4 }} />
                    Music Track
                  </span>
                  <strong>{music}%</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={music}
                  onChange={(e) => setMusic(parseInt(e.target.value, 10))}
                  disabled={isWorking}
                  aria-label="Music Track Mix"
                />
              </label>
            </div>
          </div>

          <button
            type="button"
            className="rerender-btn"
            disabled={isWorking}
            onClick={handleRerender}
          >
            {localBusy ? (
              <>
                <LoaderCircle className="spin" size={14} /> Re-rendering AMV…
              </>
            ) : (
              <>
                <Sparkles size={14} /> Re-render AMV (~3s)
              </>
            )}
          </button>
        </div>

        <div className="anime-output-footer">
          <small>
            {reel.savedPath ? (
              <>
                <CheckCircle2 size={13} /> Saved to folder
              </>
            ) : (
              'Ready to save'
            )}
          </small>
          <span>9:16 Vertical HD</span>
        </div>
      </div>
    </article>
  );
}
