import type { Shape } from './shapes';

export type ModelSource = 'upload' | 'path';
export type ResizeMode = 'stretch' | 'letterbox';
export type NormalizeMode = 'min_max' | 'mean_std' | 'none';
export type Postprocess = 'argmax' | 'sigmoid';

export interface CategoryMapping { label: string; channel: number; }

export interface ModelConfig {
  id: number;
  name: string;
  source: ModelSource;
  model_path: string;
  input_width: number;
  input_height: number;
  resize_mode: ResizeMode;
  normalize_mode: NormalizeMode;
  mean: number[] | null;
  std: number[] | null;
  background_channel: number;
  categories: CategoryMapping[];
  postprocess: Postprocess;
  sigmoid_threshold: number;
  enabled: boolean;
}

export interface ModelConfigInput {
  name: string;
  source: ModelSource;
  model_path: string;
  input_width: number;
  input_height: number;
  resize_mode: ResizeMode;
  normalize_mode: NormalizeMode;
  mean: number[] | null;
  std: number[] | null;
  background_channel: number;
  categories: CategoryMapping[];
  postprocess: Postprocess;
  sigmoid_threshold: number;
  enabled: boolean;
}

export interface InferenceJob {
  id: number;
  image_id: number;
  model_config_id: number;
  scope: 'single' | 'batch';
  status: 'queued' | 'running' | 'done' | 'failed';
  error: string | null;
}

export interface Draft {
  imageName: string;
  modelConfigId: number;
  modelName: string;
  createdAt: string;
  shapes: Shape[];
}
