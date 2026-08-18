import { useEffect, useCallback } from 'react';
import BatchSelector from '../components/panels/BatchSelector';
import ImageList from '../components/panels/ImageList';
import KonvaStage from '../components/canvas/KonvaStage';
import RightPanel from '../components/panels/RightPanel';
import CanvasControls from '../components/toolbar/CanvasControls';
import ExportDialog from '../components/panels/ExportDialog';
import { useLabelStore } from '../stores/labelStore';
import { useEditorStore } from '../stores/editorStore';
import { useImageStore } from '../stores/imageStore';
import { useUIStore } from '../stores/uiStore';
import { useAutoSave } from '../hooks/useAutoSave';
import { apiClient } from '../api/client';
import styles from './AnnotationPage.module.css';

export default function AnnotationPage() {
  const loadLabels = useLabelStore(s => s.load);
  const leftCollapsed = useUIStore(s => s.leftPanelCollapsed);
  const rightCollapsed = useUIStore(s => s.rightPanelCollapsed);
  const toggleLeftPanel = useUIStore(s => s.toggleLeftPanel);
  const toggleRightPanel = useUIStore(s => s.toggleRightPanel);
  const exportOpen = useUIStore(s => s.exportDialogOpen);
  const openExportDialog = useUIStore(s => s.openExportDialog);

  // Init: load labels
  useEffect(() => {
    loadLabels();
  }, [loadLabels]);

  // Auto-save
  useAutoSave();

  // --- beforeunload: release lock + warn unsaved ---
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      const { isDirty } = useEditorStore.getState();
      const { currentImage, lockedByMe } = useImageStore.getState();

      // Release lock via fetch with keepalive for reliable page-close delivery
      if (currentImage && lockedByMe) {
        const token = apiClient.getToken();
        fetch(`/api/images/${currentImage.id}/lock`, {
          method: 'DELETE',
          keepalive: true,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).catch(() => { /* ignore failure on page close */ });
      }

      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // --- Keyboard shortcuts ---
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if typing in an input
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const store = useEditorStore.getState();
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+Z — undo
    if (ctrl && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      // During polygon drawing, pop vertex
      if (store.drawingPoints !== null && store.drawingPoints.length > 0) {
        store.popDrawingVertex();
      } else {
        store.undo();
      }
      return;
    }

    // Ctrl+Shift+Z — redo
    if (ctrl && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      store.redo();
      return;
    }

    // Escape — cancel drawing or deselect
    if (e.key === 'Escape') {
      if (store.drawingPoints !== null) {
        store.cancelDrawing();
      } else {
        store.selectShape(null);
      }
      store.setTool('polygon');
      return;
    }

    // Delete / Backspace — delete selected shape
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.selectedShapeId) {
        store.deleteSelectedShape();
      }
      return;
    }

    // Arrow keys — previous/next image (ignore while drawing a polygon)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (store.drawingPoints === null) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') {
          useImageStore.getState().goPrevImage();
        } else {
          useImageStore.getState().goNextImage();
        }
      }
      return;
    }

    // Tool shortcuts: P, F, S, A, X
    const key = e.key.toLowerCase();
    if (key === 'p') {
      store.setTool('polygon');
      return;
    }
    if (key === 'f') {
      store.setTool('freehand');
      return;
    }
    if (key === 's') {
      store.setTool('select');
      return;
    }
    if (key === 'a') {
      store.setTool('add');
      return;
    }
    if (key === 'x') {
      store.setTool('cut');
      return;
    }

    // Number keys 1-9: select label by index
    if (e.key >= '1' && e.key <= '9') {
      const { labels } = useLabelStore.getState();
      const enabled = labels.filter(l => l.enabled);
      const idx = parseInt(e.key) - 1;
      if (idx < enabled.length) {
        const current = store.selectedLabel;
        store.setSelectedLabel(current === enabled[idx].name ? null : enabled[idx].name);
      }
      return;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        {/* Left panel */}
        <aside className={`${styles.sidebar} ${styles.sidebarLeft} ${leftCollapsed ? styles.collapsed : ''}`}>
          <div className={styles.sidebarHeader}>
            <button
              className={styles.toggle}
              onClick={toggleLeftPanel}
              title={leftCollapsed ? '展开图像列表' : '收起图像列表'}
            >
              {leftCollapsed ? '›' : '‹'}
            </button>
          </div>
          {!leftCollapsed && (
            <div className={styles.body}>
              <BatchSelector />
              <div className={styles.exportBar}>
                <button className={styles.exportBtn} onClick={openExportDialog}>
                  ⇩ 导出标注
                </button>
              </div>
              <ImageList />
            </div>
          )}
        </aside>

        {/* Center — canvas + floating controls */}
        <div className={styles.center}>
          <KonvaStage />
          <CanvasControls />
        </div>

        {/* Right panel */}
        <aside className={`${styles.sidebar} ${styles.sidebarRight} ${rightCollapsed ? styles.collapsed : ''}`}>
          <div className={styles.sidebarHeader}>
            <button
              className={styles.toggle}
              onClick={toggleRightPanel}
              title={rightCollapsed ? '展开标注面板' : '收起标注面板'}
            >
              {rightCollapsed ? '‹' : '›'}
            </button>
          </div>
          {!rightCollapsed && (
            <div className={styles.body}>
              <RightPanel />
            </div>
          )}
        </aside>
      </div>

      {exportOpen && <ExportDialog />}
    </div>
  );
}
