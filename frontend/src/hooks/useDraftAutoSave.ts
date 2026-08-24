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

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const { draftShapes, markDraftSaved } = useDraftStore.getState();
        const img = useImageStore.getState().currentImage;
        if (!img) return;
        try {
          await saveDraft(img.id, draftShapes);
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
