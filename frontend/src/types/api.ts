export interface User {
  id: number;
  username: string;
  role: 'admin' | 'annotator';
  is_active: boolean;
  created_at: string;
}

export interface Label {
  id: number;
  name: string;
  color: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
}

export interface Batch {
  id: number;
  name: string;
  source: 'scan' | 'upload';
  note: string;
  created_at: string;
  image_count: number;
  done_count: number;
}

export interface ImageInfo {
  id: number;
  batch_id: number;
  file_name: string;
  width: number;
  height: number;
  channels: number;
  status: 'pending' | 'in_progress' | 'done';
  locked_by: number | null;
  locked_by_username: string | null;
  annotation_rev: number;
  created_at: string;
  updated_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  username: string;
  role: string;
}

export interface ApiErrorBody {
  detail: string;
}
