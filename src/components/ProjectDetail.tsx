import React from 'react';
import {
  RotateCcw,
  Pause,
  Trash2,
  HardDrive,
  Sparkles,
  FolderDown,
  CheckCircle2,
  AlertCircle,
  Clapperboard,
  Check,
  LoaderCircle,
  ArrowLeft,
} from 'lucide-react';
import type { Job, AnimeRerenderOptions } from '../../shared/types';
import { AnimeReelCard } from './AnimeReelCard';
import { durationFormat } from '../lib/format';
import { podcastStages, animeStages, stageLabels } from '../lib/stages';

interface ProjectDetailProps {
  job: Job;
  busy: boolean;
  onAction: (action: 'pause' | 'resume' | 'delete') => void;
  onSave: () => void;
  onRerender: (conceptId: number, options: AnimeRerenderOptions) => Promise<void>;
  back: () => void;
}

const detailStageLabels: Record<string, string> = { ...stageLabels, rendering: 'Rendering 9:16' };

export function ProjectDetail({
  job,
  busy,
  onAction,
  onSave,
  onRerender,
  back,
}: ProjectDetailProps) {
  const isAnime = job.studio === 'anime';
  const currentStages = isAnime ? animeStages : podcastStages;
  const done = job.stage === 'completed' || job.stage === 'expired';
  const recover = ['paused', 'failed'].includes(job.stage);
  const hours = job.cleanupAt ? Math.max(0, (job.cleanupAt - Date.now()) / 3600000) : 0;
  const currentStage = recover ? job.checkpoint : job.stage;
  const stageIndex = (currentStages as readonly string[]).indexOf(currentStage);
  const savedCount = job.outputs.filter((reel) => reel.savedPath).length;

  return (
    <div className="project-detail">
      <button className="text-button back-button" onClick={back}>
        <ArrowLeft size={16} /> Back to Studio
      </button>

      {/* Project Heading */}
      <div className="project-heading">
        <div>
          <div className="eyebrow">
            {done ? 'PROJECT RESULTS' : recover ? 'PROJECT RECOVERY' : 'PROJECT IN PROGRESS'}
          </div>
          <h1 className="job-title">{job.name || job.title}</h1>
          {job.name && job.name !== job.title && <small>Source Video: {job.title}</small>}
          <p>{job.message}</p>
        </div>
        <span className={`badge ${job.stage}`}>{detailStageLabels[job.stage]}</span>
      </div>

      {/* Live Pipeline Tracker */}
      {!done && (
        <section className="panel processing">
          <div className="progress-title">
            <div>
              <span className="eyebrow">
                {recover
                  ? 'LAST SAVED STAGE'
                  : `${isAnime ? 'ANIME STUDIO' : (job.provider || 'LOCAL').toUpperCase()} · ACTIVE PIPELINE`}
              </span>
              <h2>{recover ? detailStageLabels[currentStage] || 'Ready to resume' : detailStageLabels[job.stage]}</h2>
            </div>
            <span>
              {Math.floor(job.progress)}
              <small className="bar-percentage">%</small>
            </span>
          </div>

          <progress value={job.progress} max={100} aria-label="Overall processing progress" />
          <p className="processing-message" role="status">
            {job.message}
          </p>

          <div className="pipeline" aria-label="Processing stages">
            {currentStages.slice(0, -1).map((s, i) => (
              <div key={s} className={stageIndex > i ? 'finished' : stageIndex === i ? 'current' : ''}>
                <span>{stageIndex > i ? <Check size={16} /> : i + 1}</span>
                {detailStageLabels[s]}
              </div>
            ))}
          </div>

          <div className="process-actions">
            {recover ? (
              <button className="primary" disabled={busy} onClick={() => onAction('resume')}>
                <RotateCcw size={16} /> Resume Project
              </button>
            ) : job.stage === 'expired' ? null : (
              <button className="secondary" disabled={busy} onClick={() => onAction('pause')}>
                <Pause size={16} /> Pause Processing
              </button>
            )}
            <small className="meta-muted">
              {isAnime
                ? job.animeAnalysis
                  ? `${job.animeAnalysis.shotCount} shots detected so far. `
                  : ''
                : job.outputs.length
                ? `${job.outputs.length} ${job.outputs.length === 1 ? 'Reel' : 'Reels'} rendered so far. `
                : ''}
              Progress is checkpointed after each stage.
            </small>
          </div>
        </section>
      )}

      {/* Fallback History */}
      {!!job.fallbacks?.length && (
        <section className="fallback-history" aria-label="Automatic fallback status">
          <strong>Automatic fallback triggered:</strong>
          <ul>
            {job.fallbacks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <small>Processing continues safely with the next local option.</small>
        </section>
      )}

      {/* Error Alert */}
      {job.error && (
        <div className="alert" role="alert">
          <AlertCircle size={18} />
          <span>{job.error}</span>
        </div>
      )}

      {/* Recovery/Cleanup Warning */}
      {job.cleanupAt && !job.workingDeleted && (
        <div className={`recovery ${hours < 2 ? 'urgent' : ''}`}>
          <HardDrive size={18} />
          <p>
            {done ? 'Working scratch files' : 'Recovery checkpoint files'} expire in{' '}
            <strong>
              {hours < 1 ? Math.ceil(hours * 60) + ' minutes' : Math.ceil(hours) + ' hours'}
            </strong>
            . {done ? 'Unsaved finished Reels stay available.' : 'Resume before this window ends.'}
          </p>
        </div>
      )}

      {/* Anime Intelligence & Candidate Inspector */}
      {isAnime && done && job.animeAnalysis && (
        <div className="anime-analysis-card">
          <div className="analysis-header">
            <Sparkles size={26} />
            <div>
              <h3>Anime Intelligence & Candidates Ready</h3>
              <p>
                Local analysis complete: Visual motion calculated, audio dynamics mapped, beat grid locked, and candidate moments ranked.
              </p>
            </div>
          </div>

          <div className="analysis-stats">
            <div className="stat-box">
              <strong>
                {job.animeAnalysis.conceptsCount || job.animeAnalysis.concepts?.length || 0}
              </strong>
              <small>AMV Concepts</small>
            </div>
            <div className="stat-box">
              <strong>{job.animeAnalysis.candidatesCount || 0}</strong>
              <small>Ranked Candidates</small>
            </div>
            <div className="stat-box">
              <strong>{job.animeAnalysis.bpm} BPM</strong>
              <small>Music Tempo</small>
            </div>
            <div className="stat-box">
              <strong>
                {job.animeAnalysis.language === 'ja' ? 'Japanese (JA)' : 'English Dub (EN)'}
              </strong>
              <small>Dialogue Track</small>
            </div>
          </div>

          {/* Concepts Section */}
          {!!job.animeAnalysis.concepts?.length && (
            <div className="concepts-section">
              <div className="candidate-heading">
                <h4>Selected AMV Edit Concepts ({job.animeAnalysis.concepts.length} Ready)</h4>
                <small>Diverse concepts optimized for 9:16 vertical AMV edits</small>
              </div>
              <div className="concepts-grid">
                {job.animeAnalysis.concepts.map((c) => (
                  <div key={c.id} className="concept-card">
                    <div className="concept-top">
                      <span className={`candidate-tag ${c.category}`}>
                        {c.category.toUpperCase()}
                      </span>
                      <span className="concept-style-tag">
                        {c.style.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </div>
                    <strong>{c.title}</strong>
                    <p>{c.description}</p>
                    <div className="concept-footer">
                      <span>
                        {c.duration}s Cut (Impact @ {c.impactTime}s)
                      </span>
                      <span className="concept-score">{c.qualityScore}% Quality</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Candidate Moments Grid */}
          {!!job.animeAnalysis.candidates?.length && (
            <div className="candidate-moments-section section-spaced">
              <div className="candidate-heading">
                <h4>Ranked Candidate Moments</h4>
                <small>Top moments analyzed for beat alignment</small>
              </div>
              <div className="candidate-grid">
                {job.animeAnalysis.candidates.slice(0, 12).map((c) => (
                  <div key={c.id} className="candidate-card">
                    <div className="candidate-header">
                      <span className={`candidate-tag ${c.category}`}>
                        {c.category.toUpperCase()}
                      </span>
                      <span className="candidate-score">
                        {Math.round(c.totalScore * 100)}% Match
                      </span>
                    </div>
                    <div className="candidate-timing">
                      <strong>{c.duration}s</strong>
                      <small>
                        {c.start}s → {c.end}s (Hit: {c.impactTime}s)
                      </small>
                    </div>
                    {c.hasDialogue && c.dialogueText && (
                      <p className="candidate-dialogue">"{c.dialogueText}"</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rendered Reels Results */}
      {job.outputs.length > 0 ? (
        <section className="results-section">
          <div className="results-heading">
            <div>
              <span className="eyebrow">{done ? 'RENDER COMPLETE' : 'FINISHED SO FAR'}</span>
              <h2>
                {job.outputs.length} {job.outputs.length === 1 ? 'Reel' : 'Reels'} Ready
              </h2>
              <p>
                {savedCount === job.outputs.length
                  ? 'All Reels are safely saved to your designated folder.'
                  : `${savedCount} saved · ${job.outputs.length - savedCount} ready to save`}
              </p>
            </div>
            {done && (
              <button
                className="primary"
                disabled={busy || savedCount === job.outputs.length}
                onClick={onSave}
              >
                {busy ? <LoaderCircle className="spin" size={17} /> : <FolderDown size={17} />}
                {savedCount === job.outputs.length ? 'All Reels Saved' : 'Save Reels to Folder'}
              </button>
            )}
          </div>

          <div className="reel-grid">
            {job.outputs.map((reel, i) =>
              isAnime ? (
                <AnimeReelCard
                  key={reel.id}
                  job={job}
                  reel={reel}
                  index={i}
                  busy={busy}
                  onRerender={onRerender}
                />
              ) : (
                <article className="output-card" key={reel.id}>
                  <video
                    controls
                    preload="metadata"
                    src={`reel://output/${job.id}/${reel.id}`}
                    aria-label={`Reel ${i + 1}: ${reel.title}`}
                  />
                  <div>
                    <span className="eyebrow">
                      REEL {String(i + 1).padStart(2, '0')}{' '}
                      <span>{durationFormat(reel.duration)}</span>
                    </span>
                    <h3>{reel.title}</h3>
                    <small>
                      {reel.savedPath ? (
                        <>
                          <CheckCircle2 size={13} /> Saved to folder
                        </>
                      ) : (
                        'Ready to save'
                      )}
                    </small>
                  </div>
                </article>
              )
            )}
          </div>

          <p className="privacy">
            <FolderDown size={15} /> Choose any folder outside REELMIND. Internal copies are safely
            cleaned only after files are verified.
          </p>
        </section>
      ) : (
        done &&
        !isAnime && (
          <div className="result-empty">
            <Clapperboard size={28} />
            <h2>No Reels generated in this project</h2>
            <p>{job.message}</p>
          </div>
        )
      )}

      {/* Danger Zone */}
      <button
        className="danger-text card-spaced"
        disabled={busy}
        onClick={() => onAction('delete')}
      >
        <Trash2 size={15} /> Delete Project
      </button>
    </div>
  );
}
