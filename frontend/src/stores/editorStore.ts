import { create } from 'zustand';
import type { EditorTool, LabelStatusValue, Shape, Snapshot } from '../types/shapes';
import {
  unionPolygons,
  unionMany,
  subtractPolygons,
  polygonsOverlap,
  shapeArea,
  type PolyWithHoles,
} from '../utils/geometry';

const MAX_UNDO = 50;

/** Index of the piece with the largest area. */
function indexOfLargest(pieces: PolyWithHoles[]): number {
  let best = 0;
  let bestArea = -1;
  for (let i = 0; i < pieces.length; i++) {
    const a = shapeArea(pieces[i]);
    if (a > bestArea) { bestArea = a; best = i; }
  }
  return best;
}

/** Axis-aligned bounding box of a point list: [minX, minY, maxX, maxY]. */
function bboxOf(points: number[][]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** True if two bounding boxes overlap (inclusive, so edge-touching counts). */
function bboxIntersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function cloneShape(s: Shape): Shape {
  return {
    ...s,
    points: s.points.map(p => [...p]),
    holes: (s.holes ?? []).map(h => h.map(p => [...p])),
  };
}

function cloneSnapshot(shapes: Shape[], labelStatus: Record<string, LabelStatusValue>): Snapshot {
  return {
    shapes: shapes.map(cloneShape),
    labelStatus: { ...labelStatus },
  };
}

interface EditorState {
  // Data
  shapes: Shape[];
  labelStatus: Record<string, LabelStatusValue>;
  version: number;

  // UI
  currentTool: EditorTool;
  selectedLabel: string | null;
  selectedShapeId: string | null;

  // Drawing
  drawingPoints: number[][] | null;

  // Undo/Redo
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  // Dirty flag
  isDirty: boolean;

  // Actions — Tool
  setTool: (tool: EditorTool) => void;
  setSelectedLabel: (label: string | null) => void;
  selectShape: (id: string | null) => void;

  // Actions — Drawing
  startDrawing: () => void;
  addDrawingPoint: (x: number, y: number) => void;
  popDrawingVertex: () => void;
  finishDrawing: () => void;
  cancelDrawing: () => void;

  // Actions — Shapes
  updateShape: (id: string, points: number[][], holes?: number[][][]) => void;
  deleteSelectedShape: () => void;
  applyAdd: (drawnPoints: number[][]) => void;
  applyCut: (drawnPoints: number[][]) => void;

  // Actions — Label status
  setLabelStatus: (label: string, status: LabelStatusValue) => void;
  cycleLabelStatus: (label: string) => void;
  setLabelsAbsent: (labels: string[]) => void;

  // Actions — Undo/Redo
  undo: () => void;
  redo: () => void;

  // Actions — Data loading
  loadAnnotation: (shapes: Shape[], labelStatus: Record<string, LabelStatusValue>, version: number) => void;
  reset: () => void;

  // Actions — Save
  markSaved: (newVersion: number) => void;
  markSaving: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  shapes: [],
  labelStatus: {},
  version: 0,
  currentTool: 'polygon',
  selectedLabel: null,
  selectedShapeId: null,
  drawingPoints: null,
  undoStack: [],
  redoStack: [],
  isDirty: false,

  setTool: (tool) => set({ currentTool: tool }),

  setSelectedLabel: (label) => set({ selectedLabel: label }),

  selectShape: (id) => set({ selectedShapeId: id }),

  // --- Drawing ---
  startDrawing: () => set({ drawingPoints: [] }),

  addDrawingPoint: (x, y) => {
    const { drawingPoints } = get();
    if (drawingPoints === null) return;
    set({ drawingPoints: [...drawingPoints, [x, y]] });
  },

  popDrawingVertex: () => {
    const { drawingPoints } = get();
    if (!drawingPoints || drawingPoints.length === 0) return;
    if (drawingPoints.length === 1) {
      set({ drawingPoints: null });
    } else {
      set({ drawingPoints: drawingPoints.slice(0, -1) });
    }
  },

  finishDrawing: () => {
    const { drawingPoints, shapes, labelStatus, selectedLabel } = get();
    if (!drawingPoints || drawingPoints.length < 3 || !selectedLabel) return;

    const shape: Shape = {
      id: crypto.randomUUID(),
      label: selectedLabel,
      shapeType: 'polygon',
      points: drawingPoints.map(p => [...p]),
    };

    // Push undo snapshot
    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);

    set({
      shapes: [...shapes, shape],
      labelStatus: { ...labelStatus, [selectedLabel]: 'present' },
      drawingPoints: null,
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  cancelDrawing: () => set({ drawingPoints: null }),

  // --- Shape editing ---
  updateShape: (id, points, holes) => {
    const { shapes, labelStatus } = get();
    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);

    set({
      shapes: shapes.map(s =>
        s.id === id ? { ...s, points, ...(holes !== undefined ? { holes } : {}) } : s),
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  deleteSelectedShape: () => {
    const { selectedShapeId, shapes, labelStatus } = get();
    if (!selectedShapeId) return;
    const deleted = shapes.find(s => s.id === selectedShapeId);
    if (!deleted) return;
    const label = deleted.label;
    const remaining = shapes.filter(s => s.id !== selectedShapeId);
    const newStatus: LabelStatusValue = remaining.some(s => s.label === label) ? 'present' : 'absent';
    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);
    set({
      shapes: remaining,
      labelStatus: { ...labelStatus, [label]: newStatus },
      selectedShapeId: null,
      undoStack, redoStack: [], isDirty: true,
    });
  },

  // --- Boolean operations (add/cut) ---

  applyAdd: (drawnPoints) => {
    const { selectedShapeId, shapes, labelStatus } = get();
    if (!selectedShapeId) return;

    const selected = shapes.find(s => s.id === selectedShapeId);
    if (!selected) return;

    // Start with (selected + drawn)
    const selPoly: PolyWithHoles = { points: selected.points, holes: selected.holes ?? [] };
    const drawnPoly: PolyWithHoles = { points: drawnPoints, holes: [] };
    let merged = unionPolygons(selPoly, drawnPoly);

    if (merged.length === 0) return;

    // 只合并与绘制区域真正重叠的同标签形状：先用包围盒排除绝大多数远距离 mask，
    // 再对少数候选做精确重叠判断。避免对几百个 mask 逐个做并集导致增添响应缓慢
    // （裁剪只做一次差集，所以不受影响）。
    const drawnBBox = bboxOf(drawnPoints);
    const absorbedIds = new Set<string>([selected.id]);
    const absorbed: PolyWithHoles[] = [];
    for (const s of shapes) {
      if (s.id === selected.id || s.label !== selected.label) continue;
      if (!bboxIntersects(bboxOf(s.points), drawnBBox)) continue;
      const sp: PolyWithHoles = { points: s.points, holes: s.holes ?? [] };
      if (polygonsOverlap(drawnPoly, sp)) {
        absorbedIds.add(s.id);
        absorbed.push(sp);
      }
    }
    if (absorbed.length > 0) {
      merged = unionMany([...merged, ...absorbed]);
    }

    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);

    const remaining = shapes.filter(s => !absorbedIds.has(s.id));

    // Create new shapes from the merged multi-polygon result.
    // polygon-clipping may reorder pieces, so `merged[0]` is not guaranteed to
    // be the selected shape's continuation. Assign `selected.id` to the piece
    // that overlaps the original selected shape to keep the selection stable.
    let selectedIdx = merged.findIndex(p => polygonsOverlap(p, selPoly));
    if (selectedIdx === -1) selectedIdx = indexOfLargest(merged);

    const newShapes: Shape[] = merged.map((p, i) => ({
      id: i === selectedIdx ? selected.id : crypto.randomUUID(),
      label: selected.label,
      shapeType: 'polygon' as const,
      points: p.points,
      holes: p.holes,
    }));

    set({
      shapes: [...remaining, ...newShapes],
      labelStatus: { ...labelStatus, [selected.label]: 'present' },
      selectedShapeId: selected.id,
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  applyCut: (drawnPoints) => {
    const { selectedShapeId, shapes, labelStatus } = get();
    if (!selectedShapeId) return;

    const selected = shapes.find(s => s.id === selectedShapeId);
    if (!selected) return;

    const selPoly: PolyWithHoles = { points: selected.points, holes: selected.holes ?? [] };
    const drawnPoly: PolyWithHoles = { points: drawnPoints, holes: [] };
    const result = subtractPolygons(selPoly, drawnPoly);

    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);

    if (result.length === 0) {
      // Cut removed everything — delete the shape
      const remaining = shapes.filter(s => s.id !== selectedShapeId);
      const newStatus: LabelStatusValue = remaining.some(s => s.label === selected.label) ? 'present' : 'absent';
      set({
        shapes: remaining,
        labelStatus: { ...labelStatus, [selected.label]: newStatus },
        selectedShapeId: null,
        undoStack,
        redoStack: [],
        isDirty: true,
      });
      return;
    }

    // Replace selected shape + add extra pieces if split occurred.
    // Keep `selected.id` on the largest remaining piece so selection stays on
    // the dominant continuation (polygon-clipping may reorder pieces).
    const others = shapes.filter(s => s.id !== selected.id);
    const selectedIdx = indexOfLargest(result);
    const newShapes: Shape[] = result.map((p, i) => ({
      id: i === selectedIdx ? selected.id : crypto.randomUUID(),
      label: selected.label,
      shapeType: 'polygon' as const,
      points: p.points,
      holes: p.holes,
    }));

    set({
      shapes: [...others, ...newShapes],
      labelStatus: { ...labelStatus, [selected.label]: 'present' },
      selectedShapeId: selected.id,
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  // --- Label status ---
  setLabelStatus: (label, status) => {
    const { shapes, labelStatus } = get();
    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);

    set({
      labelStatus: { ...labelStatus, [label]: status },
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  cycleLabelStatus: (label) => {
    const { labelStatus, shapes } = get();
    const current = labelStatus[label] ?? 'pending';
    const hasShapes = shapes.some(s => s.label === label);
    const next: LabelStatusValue =
      current === 'pending' ? (hasShapes ? 'present' : 'absent') : 'pending';
    get().setLabelStatus(label, next);
  },

  setLabelsAbsent: (labels) => {
    const { shapes, labelStatus } = get();
    if (labels.length === 0) return;
    const snapshot = cloneSnapshot(shapes, labelStatus);
    const updates: Record<string, LabelStatusValue> = {};
    for (const l of labels) updates[l] = 'absent';
    set({
      labelStatus: { ...labelStatus, ...updates },
      undoStack: [...get().undoStack, snapshot].slice(-MAX_UNDO),
      redoStack: [],
      isDirty: true,
    });
  },

  // --- Undo/Redo ---
  undo: () => {
    const { undoStack, shapes, labelStatus } = get();
    if (undoStack.length === 0) return;

    const snapshot = cloneSnapshot(shapes, labelStatus);
    const prev = undoStack[undoStack.length - 1];

    set({
      shapes: prev.shapes.map(cloneShape),
      labelStatus: { ...prev.labelStatus },
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, snapshot],
      isDirty: true,
    });
  },

  redo: () => {
    const { redoStack, shapes, labelStatus } = get();
    if (redoStack.length === 0) return;

    const snapshot = cloneSnapshot(shapes, labelStatus);
    const next = redoStack[redoStack.length - 1];

    set({
      shapes: next.shapes.map(cloneShape),
      labelStatus: { ...next.labelStatus },
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, snapshot],
      isDirty: true,
    });
  },

  // --- Data ---
  loadAnnotation: (shapes, labelStatus, version) => {
    set({
      shapes: shapes.map(cloneShape),
      labelStatus: { ...labelStatus },
      version,
      drawingPoints: null,
      selectedShapeId: null,
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  },

  reset: () => {
    set({
      shapes: [],
      labelStatus: {},
      version: 0,
      drawingPoints: null,
      selectedShapeId: null,
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  },

  markSaved: (newVersion) => {
    set({ version: newVersion, isDirty: false });
  },

  markSaving: () => {
    // No state change — just a signal; UI store handles saveStatus
  },
}));
