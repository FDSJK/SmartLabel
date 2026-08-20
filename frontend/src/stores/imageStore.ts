import { create } from 'zustand';
import type { ImageInfo } from '../types/api';
import type { LabelStatusValue } from '../types/shapes';
import { fetchImage } from '../api/images';
import { acquireLock, releaseLock, sendHeartbeat } from '../api/locks';
import { fetchAnnotation } from '../api/annotations';
import { useEditorStore } from './editorStore';
import { useUIStore } from './uiStore';
import { useBatchStore } from './batchStore';

interface ImageState {
  currentImage: ImageInfo | null;
  loading: boolean;
  lockedByMe: boolean;
  heartbeatTimer: ReturnType<typeof setInterval> | null;

  loadImage: (imageId: number) => Promise<boolean>;
  releaseCurrentLock: () => Promise<void>;
  startHeartbeat: (imageId: number) => void;
  stopHeartbeat: () => void;
  clearImage: () => void;
  goPrevImage: () => void;
  goNextImage: () => void;
}

export const useImageStore = create<ImageState>((set, get) => ({
  currentImage: null,
  loading: false,
  lockedByMe: false,
  heartbeatTimer: null,

  loadImage: async (imageId) => {
    const state = get();
    console.log('[loadImage] imageId=', imageId);
    // Release previous lock if any
    if (state.currentImage && state.lockedByMe) {
      await state.releaseCurrentLock();
    }

    set({ loading: true });

    try {
      // Try to acquire lock
      const lockResult = await acquireLock(imageId);

      if (!lockResult.locked) {
        // Someone else holds the lock — load in read-only mode
        const img = await fetchImage(imageId);
        const annotation = await fetchAnnotation(imageId);
        useEditorStore.getState().loadAnnotation(
          annotation.shapes,
          annotation.labelStatus as Record<string, LabelStatusValue>,
          annotation.version,
        );
        set({
          currentImage: { ...img, locked_by_username: lockResult.locked_by_username },
          loading: false,
          lockedByMe: false,
        });
        // Update lock indicator in batch image list
        useBatchStore.getState().updateImageLock(imageId, lockResult.locked_by_username);
        return false;
      }

      // Lock acquired — load full data
      const img = await fetchImage(imageId);
      const annotation = await fetchAnnotation(imageId);

      useEditorStore.getState().loadAnnotation(
        annotation.shapes,
        annotation.labelStatus as Record<string, LabelStatusValue>,
        annotation.version,
      );

      // Fit image to screen
      const { fitToScreen } = useUIStore.getState();
      fitToScreen(img.width, img.height, window.innerWidth - 540, window.innerHeight - 100);

      set({
        currentImage: img,
        loading: false,
        lockedByMe: true,
      });

      // Update lock indicator in batch image list
      useBatchStore.getState().updateImageLock(imageId, lockResult.locked_by_username);

      // Start heartbeat
      get().startHeartbeat(imageId);
      return true;
    } catch {
      set({ loading: false });
      return false;
    }
  },

  releaseCurrentLock: async () => {
    const { currentImage, lockedByMe } = get();
    get().stopHeartbeat();
    if (currentImage && lockedByMe) {
      try {
        await releaseLock(currentImage.id);
      } catch {
        // Ignore errors on release
      }
      // Clear lock indicator in batch image list
      useBatchStore.getState().updateImageLock(currentImage.id, null);
    }
    set({ lockedByMe: false });
  },

  startHeartbeat: (imageId) => {
    get().stopHeartbeat();
    const timer = setInterval(() => {
      sendHeartbeat(imageId).catch(() => {
        // Heartbeat failed — stop trying
        get().stopHeartbeat();
      });
    }, 60_000);
    set({ heartbeatTimer: timer });
  },

  stopHeartbeat: () => {
    const { heartbeatTimer } = get();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      set({ heartbeatTimer: null });
    }
  },

  clearImage: () => {
    get().stopHeartbeat();
    useEditorStore.getState().reset();
    set({ currentImage: null, loading: false, lockedByMe: false });
  },

  goPrevImage: () => {
    const { currentImage, loading } = get();
    if (!currentImage || loading) return;
    const images = useBatchStore.getState().images;
    const idx = images.findIndex(i => i.id === currentImage.id);
    if (idx > 0) get().loadImage(images[idx - 1].id);
  },

  goNextImage: () => {
    const { currentImage, loading } = get();
    if (!currentImage || loading) return;
    const images = useBatchStore.getState().images;
    const idx = images.findIndex(i => i.id === currentImage.id);
    if (idx >= 0 && idx < images.length - 1) get().loadImage(images[idx + 1].id);
  },
}));
