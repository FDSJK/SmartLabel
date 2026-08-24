import { create } from 'zustand';
import type { Shape, LabelStatusValue } from '../types/shapes';
import { fetchDraft, acceptDraft as acceptDraftApi, rejectDraft as rejectDraftApi } from '../api/draft';
import { useEditorStore } from './editorStore';

function cloneShape(s: Shape): Shape {
  return {
    ...s,
    points: s.points.map((p) => [...p]),
    holes: (s.holes ?? []).map((h) => h.map((p) => [...p])),
  };
}

interface DraftMeta {
  modelConfigId: number;
  modelName: string;
  createdAt: string;
}

interface DraftState {
  draftShapes: Shape[];
  draftMeta: DraftMeta | null;
  selectedDraftId: string | null;
  isDirty: boolean;
  status: 'none' | 'loading' | 'ready';
  _loadingImageId: number | null;

  loadDraft: (imageId: number) => Promise<void>;
  selectDraft: (id: string | null) => void;
  moveDraftShape: (id: string, points: number[][], holes?: number[][][]) => void;
  moveDraftVertex: (id: string, vertexIndex: number, x: number, y: number) => void;
  deleteDraftShape: (id: string) => void;
  acceptDraft: (imageId: number) => Promise<void>;
  rejectDraft: (imageId: number) => Promise<void>;
  markDraftSaved: () => void;
  clear: () => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  draftShapes: [],
  draftMeta: null,
  selectedDraftId: null,
  isDirty: false,
  status: 'none',
  _loadingImageId: null,

  loadDraft: async (imageId) => {
    set({ status: 'loading', _loadingImageId: imageId });
    try {
      const d = await fetchDraft(imageId);
      if (get()._loadingImageId !== imageId) return;  // 切图了，丢弃过期结果
      set({
        draftShapes: d.shapes.map(cloneShape),
        draftMeta: { modelConfigId: d.modelConfigId, modelName: d.modelName, createdAt: d.createdAt },
        status: 'ready',
        selectedDraftId: null,
        isDirty: false,
      });
    } catch {
      if (get()._loadingImageId !== imageId) return;
      set({ draftShapes: [], draftMeta: null, status: 'none', selectedDraftId: null, isDirty: false });
    }
  },

  selectDraft: (id) => {
    set({ selectedDraftId: id });
    if (id) useEditorStore.getState().selectShape(null);
  },

  moveDraftShape: (id, points, holes) =>
    set((s) => ({
      draftShapes: s.draftShapes.map((d) =>
        d.id === id ? { ...d, points, ...(holes !== undefined ? { holes } : {}) } : d),
      isDirty: true,
    })),

  moveDraftVertex: (id, vertexIndex, x, y) =>
    set((s) => ({
      draftShapes: s.draftShapes.map((d) => {
        if (d.id !== id) return d;
        const points = d.points.map((p) => [...p]);
        points[vertexIndex] = [x, y];
        return { ...d, points };
      }),
      isDirty: true,
    })),

  deleteDraftShape: (id) =>
    set((s) => ({
      draftShapes: s.draftShapes.filter((d) => d.id !== id),
      selectedDraftId: s.selectedDraftId === id ? null : s.selectedDraftId,
      isDirty: true,
    })),

  acceptDraft: async (imageId) => {
    const rev = useEditorStore.getState().version;
    const result = await acceptDraftApi(imageId, rev);
    // 直接加载接受后的标注（shapes + labelStatus + rev），避免重新走锁
    useEditorStore.getState().loadAnnotation(
      result.shapes,
      result.labelStatus as Record<string, LabelStatusValue>,
      result.rev,
    );
    get().clear();
  },

  rejectDraft: async (imageId) => {
    await rejectDraftApi(imageId);
    get().clear();
  },

  markDraftSaved: () => set({ isDirty: false }),
  clear: () => set({ draftShapes: [], draftMeta: null, selectedDraftId: null, isDirty: false, status: 'none', _loadingImageId: null }),
}));
