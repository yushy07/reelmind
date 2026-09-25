import React, { useState, useEffect } from 'react';
import { Sparkles, LoaderCircle, CheckCircle2, Music, Volume2, FolderDown, AlertCircle } from 'lucide-react';
import type { Job, AnimeEditStyle, AnimeRerenderOptions } from '../../shared/types';
import { durationFormat, formatTimeRange, energyLabel } from '../lib/format';

interface AnimeReelCardProps {
  job: Job;
  reel: Job['outputs'][0];
  index: number;
  busy: boolean;
  onRerender: (conceptId: number, options: AnimeRerenderOptions) => Promise<void>;
  onSave?: (reelId: string) => void;
}

export function AnimeReelCard({ job, reel, index, busy, onRerender, onSave }: AnimeReelCardProps) {
  const conceptId = parseInt(reel.id, 10);
  const concept = job.animeAnalysis?.concepts?.find((c) => c.id === conceptId);
  const assignedRegion = concept?.assignedMusicRegion;

  const [style, setStyle] = useState<AnimeEditStyle>(concept?.style || 'hard_beat_drop');
  const [aspect, setAspect] = useState<'9:16' | '1:1' | '16:9'>(job.input.outputAspect || '9:16');
  const [sourceAudio, setSourceAudio] = useState(40);
  const [music, setMusic] = useState(100);
  const [selectedRegionId, setSelectedRegionId] = useState<string>(assignedRegion?.id || 'auto');
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (assignedRegion?.id) {
      setSelectedRegionId(assignedRegion.id);
    }
  }, [assignedRegion?.id]);

  const availableRegions = job.animeAnalysis?.musicRegions || [];
  const activeRegion = selectedRegionId === 'auto'
    ? assignedRegion
    : availableRegions.find((r) => r.id === selectedRegionId) || assignedRegion;

  const handleRerender = async () => {
    if (localBusy || busy) return;
    setLocalBusy(true);
    setLocalError(null);
    try {
      await onRerender(conceptId, {
        style,
        sourceAudioMix: sourceAudio / 100,
        musicMix: music / 100,
        aspectRatio: aspect,
        musicRegionId: selectedRegionId !== 'auto' ? selectedRegionId : (assignedRegion?.id || undefined)
      });
    } catch (err: any) {
      setLocalError('Unable to re-render this clip. Your existing AMV remains intact.');
    } finally {
      setLocalBusy(false);
    }
  };

  const isWorking = localBusy || busy;
  const aspectValue = aspect === '16:9' ? '16/9' : aspect === '1:1' ? '1/1' : '9/16';

  return (
    <article
      className="anime-output-card"
      key={reel.id}
      style={{ ['--aspect' as any]: aspectValue }}
    >
      <video
        controls
        preload="metadata"
        key={reel.planHash || reel.id}
        src={`reel://output/${job.id}/${reel.id}?h=${reel.planHash || ''}`}
        aria-label={`AMV Edit ${index + 1}: ${reel.title}`}
        style={{ aspectRatio: aspectValue }}
        onPlay={(e) => {
          document.querySelectorAll('video').forEach((v) => {
            if (v !== e.currentTarget && !v.paused) v.pause();
          });
        }}
      />
      <div className="anime-output-body">
        <div className="anime-output-meta">
          <span className="eyebrow">
            AMV {String(index + 1).padStart(2, '0')} <span>{durationFormat(reel.duration)}</span>
          </span>
          {activeRegion && (
            <span className="eyebrow-music-pill" title="Synchronized Music Passage">
              <Music size={11} className="icon-inline-sm" />
              {activeRegion.sectionLabel.toUpperCase()} ({formatTimeRange(activeRegion.start, activeRegion.end)})
            </span>
          )}
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
              <span>Aspect Ratio</span>
              <strong>{aspect === '9:16' ? '9:16 Vertical' : aspect === '1:1' ? '1:1 Square' : '16:9 Cinema'}</strong>
            </div>
            <div className="style-pills-row">
              <button
                type="button"
                className={`style-pill-btn ${aspect === '9:16' ? 'active' : ''}`}
                onClick={() => setAspect('9:16')}
                disabled={isWorking}
              >
                📱 9:16
              </button>
              <button
                type="button"
                className={`style-pill-btn ${aspect === '1:1' ? 'active' : ''}`}
                onClick={() => setAspect('1:1')}
                disabled={isWorking}
              >
                ⏹ 1:1
              </button>
              <button
                type="button"
                className={`style-pill-btn ${aspect === '16:9' ? 'active' : ''}`}
                onClick={() => setAspect('16:9')}
                disabled={isWorking}
              >
                🖥 16:9
              </button>
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
                    <Volume2 size={12} className="icon-inline-sm" />
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
                    <Music size={12} className="icon-inline-sm" />
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

          <div className="anime-control-group">
            <div className="anime-control-header">
              <span title="The detected section of your song synchronized to this AMV.">
                Music Passage
              </span>
              <small>
                {activeRegion
                  ? `${activeRegion.sectionLabel.toUpperCase()} (${formatTimeRange(activeRegion.start, activeRegion.end)})`
                  : 'Auto Matched'}
              </small>
            </div>
            {availableRegions.length > 0 ? (
              <select
                className="music-region-select"
                value={selectedRegionId}
                onChange={(e) => {
                  setSelectedRegionId(e.target.value);
                  setLocalError(null);
                }}
                disabled={isWorking}
                aria-label="Select Music Region"
              >
                <option value="auto">
                  ⚡ Auto Matched {assignedRegion ? `(${assignedRegion.sectionLabel.toUpperCase()} · ${formatTimeRange(assignedRegion.start, assignedRegion.end)})` : ''}
                </option>
                {availableRegions.map((r) => {
                  const otherConcepts = job.animeAnalysis?.concepts?.filter((c) => c.id !== conceptId) || [];
                  const usedBy = otherConcepts.find((c) => c.assignedMusicRegion?.id === r.id);
                  return (
                    <option key={r.id} value={r.id}>
                      {r.sectionLabel.toUpperCase()} · {formatTimeRange(r.start, r.end)} ({energyLabel(r.energy)}){usedBy ? ` · ⚠️ Used by AMV ${usedBy.id}` : ''}
                    </option>
                  );
                })}
              </select>
            ) : (
              <small className="meta-muted">Full track beat sync active (no segmented regions)</small>
            )}
          </div>

          {localError && (
            <div className="anime-card-alert" role="alert">
              <AlertCircle size={14} className="icon-inline-sm" />
              <span>{localError}</span>
            </div>
          )}

          <button
            type="button"
            className="rerender-btn"
            disabled={isWorking}
            onClick={handleRerender}
            aria-busy={localBusy}
            aria-label={localBusy ? `Re-rendering AMV ${index + 1}` : `Re-render AMV ${index + 1}`}
          >
            {localBusy ? (
              <>
                <LoaderCircle className="spin" size={14} /> Re-rendering AMV…
              </>
            ) : (
              <>
                <Sparkles size={14} /> Re-render AMV
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
            ) : onSave ? (
              <button
                type="button"
                className="btn-save-single"
                onClick={() => onSave(reel.id)}
                disabled={isWorking}
                title="Save this single AMV outside REELMIND"
              >
                <FolderDown size={13} /> Save This AMV
              </button>
            ) : (
              'Ready to save'
            )}
          </small>
          <span>
            {aspect === '16:9' ? '16:9 Cinema' : aspect === '1:1' ? '1:1 Square' : '9:16 Vertical HD'}
          </span>
        </div>
      </div>
    </article>
  );
}

