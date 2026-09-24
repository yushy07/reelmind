import type { Store } from '../storage';
import type { CheckpointStore } from '../checkpoint';
import type { HardwareInfo } from '../hardware';
import type { ModelManager } from '../models';
import type { Job, Provider } from '../../shared/types';

export interface PipelineContext {
  root: string;
  runtime: string;
  workers: string;
  store: Store;
  hardware: HardwareInfo;
  checkpoints: CheckpointStore;
  models: ModelManager;
  work: (id: string) => string;
  out: (id: string) => string;
  update: (job: Job, patch: Partial<Job>) => void;
  notify: (job: Job) => void;
  key: (provider: Provider) => Promise<string>;
}
