import { create } from 'zustand';
import type { EditorTool, LabelStatusValue, Shape, Snapshot } from '../types/shapes';
import {
  unionPolygons,
  unionMany,
  subtractPolygons,
  polygonsOverlap,
  polygonArea,
} from '../utils/geometry';

const MAX_UNDO = 50;

/** Index of the piece with the largest area. */
function indexOfLargest(pieces: number[][][]): number {
  let best = 0;
  let bestArea = -1;
  for (let i = 0; i < pieces.length; i++) {
    const a = polygonArea(pieces[i]);
    if (a > bestArea) { bestArea = a; best = i; }
  }
  return best;
}

function cloneSnapshot(shapes: Shape[], labelStatus: Record<string, LabelStatusValue>): Snapshot {
  return {
    shapes: shapes.map(s => ({ ...s, points: s.points.map(p => [...p]) })),
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
  updateShape: (id: string, points: number[][]) => void;
  deleteSelectedShape: () => void;
  applyAdd: (drawnPoints: number[][]) => void;
  applyCut: (drawnPoints: number[][]) => void;

  // Actions — Label status
  setLabelStatus: (label: string, status: LabelStatusValue) => void;

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
      drawingPoints: null,
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  cancelDrawing: () => set({ drawingPoints: null }),

  // --- Shape editing ---
  updateShape: (id, points) => {
    const { shapes, labelStatus } = get();
    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);

    set({
      shapes: shapes.map(s => (s.id === id ? { ...s, points } : s)),
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  deleteSelectedShape: () => {
    const { selectedShapeId, shapes, labelStatus } = get();
    if (!selectedShapeId) return;

    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);

    set({
      shapes: shapes.filter(s => s.id !== selectedShapeId),
      selectedShapeId: null,
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  // --- Boolean operations (add/cut) ---

  applyAdd: (drawnPoints) => {
    const { selectedShapeId, shapes, labelStatus } = get();
    if (!selectedShapeId) return;

    const selected = shapes.find(s => s.id === selectedShapeId);
    if (!selected) return;

    // Collect all shapes of the same label for merging
    const sameLabel = shapes.filter(s => s.label === selected.label && s.id !== selected.id);

    // Start with (selected + drawn)
    let merged = unionPolygons(selected.points, drawnPoints);
    // Also merge any same-label shapes that the drawn area connects
    if (sameLabel.length > 0 && merged.length > 0) {
      const allPieces = [...merged, ...sameLabel.map(s => s.points)];
      merged = unionMany(allPieces);
    }

    if (merged.length === 0) return;

    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);

    // Remove all merged shapes (selected + same-label), will be recreated
    const mergedIds = new Set([selected.id, ...sameLabel.map(s => s.id)]);
    const remaining = shapes.filter(s => !mergedIds.has(s.id));

    // Create new shapes from the merged multi-polygon result.
    // polygon-clipping may reorder pieces, so `merged[0]` is not guaranteed to
    // be the selected shape's continuation. Assign `selected.id` to the piece
    // that overlaps the original selected shape to keep the selection stable.
    let selectedIdx = merged.findIndex(p => polygonsOverlap(p, selected.points));
    if (selectedIdx === -1) selectedIdx = indexOfLargest(merged);

    const newShapes: Shape[] = merged.map((points, i) => ({
      id: i === selectedIdx ? selected.id : crypto.randomUUID(),
      label: selected.label,
      shapeType: 'polygon' as const,
      points,
    }));

    set({
      shapes: [...remaining, ...newShapes],
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

    const result = subtractPolygons(selected.points, drawnPoints);

    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);

    if (result.length === 0) {
      // Cut removed everything — delete the shape
      set({
        shapes: shapes.filter(s => s.id !== selectedShapeId),
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
    const newShapes: Shape[] = result.map((points, i) => ({
      id: i === selectedIdx ? selected.id : crypto.randomUUID(),
      label: selected.label,
      shapeType: 'polygon' as const,
      points,
    }));

    set({
      shapes: [...others, ...newShapes],
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

  // --- Undo/Redo ---
  undo: () => {
    const { undoStack, shapes, labelStatus } = get();
    if (undoStack.length === 0) return;

    const snapshot = cloneSnapshot(shapes, labelStatus);
    const prev = undoStack[undoStack.length - 1];

    set({
      shapes: prev.shapes.map(s => ({ ...s, points: s.points.map(p => [...p]) })),
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
      shapes: next.shapes.map(s => ({ ...s, points: s.points.map(p => [...p]) })),
      labelStatus: { ...next.labelStatus },
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, snapshot],
      isDirty: true,
    });
  },

  // --- Data ---
  loadAnnotation: (shapes, labelStatus, version) => {
    set({
      shapes: shapes.map(s => ({ ...s, points: s.points.map(p => [...p]) })),
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
