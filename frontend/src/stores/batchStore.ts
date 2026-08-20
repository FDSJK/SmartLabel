import { create } from 'zustand';
import { fetchBatches, scanBatches, createBatch, uploadImages, deleteBatch } from '../api/batches';
import { fetchImages } from '../api/images';
import type { Batch, ImageInfo } from '../types/api';

interface BatchState {
  batches: Batch[];
  currentBatchId: number | null;
  images: ImageInfo[];
  loading: boolean;
  loadBatches: () => Promise<void>;
  selectBatch: (batchId: number) => Promise<void>;
  doScan: () => Promise<{ added: number; skipped: number; removed: number }>;
  doCreateAndUpload: (name: string, files: File[]) => Promise<void>;
  doUploadToBatch: (batchId: number, files: File[]) => Promise<void>;
  doDeleteBatch: (batchId: number) => Promise<void>;
  deselectBatch: () => void;
  reset: () => void;
  updateImageLock: (imageId: number, lockedBy: string | null) => void;
}

export const useBatchStore = create<BatchState>((set, get) => ({
  batches: [],
  currentBatchId: null,
  images: [],
  loading: false,

  loadBatches: async () => {
    const batches = await fetchBatches();
    set({ batches });
  },

  selectBatch: async (batchId) => {
    set({ loading: true, currentBatchId: batchId });
    try {
      const images = await fetchImages(batchId);
      set({ images, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  deselectBatch: () => {
    set({ currentBatchId: null, images: [] });
  },

  reset: () => {
    set({ batches: [], currentBatchId: null, images: [], loading: false });
  },

  doScan: async () => {
    const result = await scanBatches();
    await get().loadBatches();
    return result;
  },

  doCreateAndUpload: async (name, files) => {
    const batch = await createBatch(name);
    await uploadImages(batch.id, files);
    await get().loadBatches();
    await get().selectBatch(batch.id);
  },

  doUploadToBatch: async (batchId, files) => {
    await uploadImages(batchId, files);
    await get().loadBatches();
    await get().selectBatch(batchId);
  },

  doDeleteBatch: async (batchId: number) => {
    await deleteBatch(batchId);
    const state = get();
    if (state.currentBatchId === batchId) {
      set({ currentBatchId: null, images: [] });
    }
    await get().loadBatches();
  },

  updateImageLock: (imageId, lockedBy) => {
    set(s => ({
      images: s.images.map(img =>
        img.id === imageId ? { ...img, locked_by_username: lockedBy } : img,
      ),
    }));
  },
}));
