import type { Job } from '../../shared/types';
import { durationFormat } from './format';

export const podcastStages = ['importing', 'transcribing', 'framing', 'analyzing', 'rendering', 'completed'] as const;
export const animeStages = ['importing', 'scenes', 'music', 'transcribing', 'analyzing', 'rendering', 'completed'] as const;

export const stageLabels: Record<string, string> = {
  queued: 'Queued',
  importing: 'Importing',
  scenes: 'Detecting shots',
  music: 'Mapping music',
  transcribing: 'Transcribing',
  framing: 'Finding speakers',
  analyzing: 'Finding moments',
  rendering: 'Rendering',
  completed: 'Ready',
  paused: 'Paused',
  failed: 'Needs attention',
  expired: 'Expired',
};

export function isWorkingStage(stage: string, isAnime: boolean): boolean {
  const stages = isAnime ? animeStages : podcastStages;
  return (stages as readonly string[]).slice(0, -1).includes(stage);
}

export function kickerFor(job: Job): string {
  const isAnime = job.studio === 'anime';
  const details = [
    isAnime
      ? `ANIME (${job.input.language?.toUpperCase() || 'JA'})`
      : job.input.kind === 'url'
        ? 'VIDEO LINK'
        : 'LOCAL VIDEO',
    new Date(job.createdAt).toLocaleDateString(),
    job.duration ? durationFormat(job.duration) : null,
    isAnime
      ? job.outputs.length
        ? `${job.outputs.length} AMV ${job.outputs.length === 1 ? 'Edit' : 'Edits'}`
        : job.animeAnalysis
          ? `${job.animeAnalysis.shotCount} shots · ${job.animeAnalysis.bpm} BPM`
          : 'Analysis DB'
      : job.outputs.length
        ? `${job.outputs.length} ${job.outputs.length === 1 ? 'Reel' : 'Reels'} Ready`
        : null,
  ].filter(Boolean);
  return details.join('  ·  ');
}
