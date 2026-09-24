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
