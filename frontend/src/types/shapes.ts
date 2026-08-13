export type EditorTool = 'polygon' | 'freehand' | 'select' | 'add' | 'cut';

export type LabelStatusValue = 'present' | 'absent' | 'pending';

export interface Shape {
  id: string;
  label: string;
  shapeType: 'polygon';
  points: number[][];
}

export interface Snapshot {
  shapes: Shape[];
  labelStatus: Record<string, LabelStatusValue>;
}

export interface AnnotationData {
  shapes: Shape[];
  labelStatus: Record<string, LabelStatusValue>;
  version: number;
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'offline';
