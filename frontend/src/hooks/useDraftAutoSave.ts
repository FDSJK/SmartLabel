import { useEffect, useRef } from 'react';
import { useDraftStore } from '../stores/draftStore';
import { useImageStore } from '../stores/imageStore';
import { saveDraft } from '../api/draft';

const DEBOUNCE_MS = 300;

export function useDraftAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = useDraftStore.subscribe((state, prev) => {
      if (!state.isDirty || state.isDirty === prev.isDirty) return;
      const { currentImage, lockedByMe } = useImageStore.getState();
      if (!currentImage || !lockedByMe) return;
      const imageId = currentImage.id;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        // 校验仍在同一张图：切图后 loadDraft 会重置 draftShapes/isDirty，旧图编辑不应写错图
        const img = useImageStore.getState().currentImage;
        if (!img || img.id !== imageId) return;
        const { draftShapes, markDraftSaved } = useDraftStore.getState();
        try {
          await saveDraft(imageId, draftShapes);
          markDraftSaved();
        } catch {
          // 保持 isDirty，下次编辑时重试
        }
      }, DEBOUNCE_MS);
    });

    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
