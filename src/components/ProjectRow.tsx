import React from 'react';
import { Film, Sparkles, ChevronRight } from 'lucide-react';
import type { Job } from '../../shared/types';
import { podcastStages, animeStages, stageLabels, kickerFor } from '../lib/stages';

interface ProjectRowProps {
  job: Job;
  onOpen: (id: string) => void;
}

export function ProjectRow({ job, onOpen }: ProjectRowProps) {
  const isAnime = job.studio === 'anime';
  const activeStages = (isAnime ? animeStages : podcastStages).slice(0, -1);
  const working = (activeStages as readonly string[]).includes(job.stage);

  return (
    <button
      className="project-row"
      onClick={() => onOpen(job.id)}
      aria-label={`Open ${job.name || job.title}, ${stageLabels[job.stage]}`}
    >
      <span className={`project-thumb ${isAnime ? 'anime-thumb' : ''}`}>
        {isAnime ? <Sparkles size={22} /> : <Film size={22} />}
      </span>
      <span className="project-row-content">
        <span className="project-row-kicker">{kickerFor(job)}</span>
        <strong>{job.name || job.title}</strong>
        <small>
          {working
            ? job.message
            : job.stage === 'completed'
              ? isAnime
                ? job.outputs.length
                  ? `${job.outputs.length} AMV Edits ready to save`
                  : 'Analysis Database ready'
                : job.outputs.every((r) => r.savedPath)
                  ? 'Saved to your folder'
                  : 'Ready to review and save'
              : job.stage === 'paused'
                ? 'Resume before recovery expires'
                : job.stage === 'failed'
                  ? 'Open to review and retry'
                  : job.title}
        </small>
        {working && (
          <progress
            className="row-progress"
            value={job.progress}
            max={100}
            aria-label={`${job.name || job.title} progress`}
          />
        )}
      </span>
      <span className={`badge ${job.stage}`}>
        {stageLabels[job.stage]}
        {working ? ` · ${Math.floor(job.progress)}%` : ''}
      </span>
      <ChevronRight className="project-row-chevron" size={18} />
    </button>
  );
}
