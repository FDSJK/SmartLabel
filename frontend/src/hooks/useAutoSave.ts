import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useImageStore } from '../stores/imageStore';
import { useUIStore } from '../stores/uiStore';
import { saveAnnotation } from '../api/annotations';

const DEBOUNCE_MS = 300;

/**
 * Subscribes to editorStore.isDirty. On change, debounces 300ms then
 * persists via PUT /api/images/{id}/annotation.
 *
 * Handles:
 * - 409 conflict → unsaved state, user must reload
 * - Network error → offline state
 * - Success → markSaved + set version
 */
export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Subscribe to isDirty changes
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (!state.isDirty) return;
      if (state.isDirty === prev.isDirty) return; // only on edge

      const { currentImage, lockedByMe } = useImageStore.getState();
      if (!currentImage || !lockedByMe) return; // read-only — don't save

      const { setSaveStatus } = useUIStore.getState();
      setSaveStatus('unsaved');

      // Debounce
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(async () => {
        const editor = useEditorStore.getState();
        const img = useImageStore.getState().currentImage;
        if (!img) return;

        setSaveStatus('saving');

        try {
          const result = await saveAnnotation(
            img.id,
            editor.version,
            editor.shapes,
            editor.labelStatus,
          );
          useEditorStore.getState().markSaved(result.rev);
          setSaveStatus('saved');
        } catch (err: unknown) {
          const status = (err as { status?: number }).status;
          if (status === 409) {
            // Conflict — someone else saved; stay unsaved
            setSaveStatus('unsaved');
          } else {
            setSaveStatus('offline');
          }
        }
      }, DEBOUNCE_MS);
    });

    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
