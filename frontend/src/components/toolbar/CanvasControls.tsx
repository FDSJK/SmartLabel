import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import SaveIndicator from './SaveIndicator';
import styles from './CanvasControls.module.css';

/**
 * Floating controls overlaid on the canvas. Replaces the old full-width
 * TopToolbar so the canvas can use the reclaimed vertical space.
 */
export default function CanvasControls() {
  const undoStackLen = useEditorStore(s => s.undoStack.length);
  const redoStackLen = useEditorStore(s => s.redoStack.length);
  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);
  const shapeCount = useEditorStore(s => s.shapes.length);
  const zoom = useUIStore(s => s.zoom);
  const showFill = useUIStore(s => s.showFill);
  const toggleFill = useUIStore(s => s.toggleFill);

  return (
    <div className={styles.bar}>
      <button
        className={styles.btn}
        disabled={undoStackLen === 0}
        onClick={undo}
      >
        ↩
        <span className={styles.tooltip}>撤销 Ctrl+Z</span>
      </button>
      <button
        className={styles.btn}
        disabled={redoStackLen === 0}
        onClick={redo}
      >
        ↪
        <span className={styles.tooltip}>重做 Ctrl+Shift+Z</span>
      </button>

      <span className={styles.sep} />

      <button
        className={styles.btn}
        onClick={toggleFill}
      >
        {showFill ? '▣' : '□'}
        <span className={styles.tooltip}>{showFill ? '隐藏填充' : '显示填充'}</span>
      </button>

      <span className={styles.sep} />

      <span className={styles.metric}>{shapeCount} 标注</span>
      <span className={styles.metric}>{Math.round(zoom * 100)}%</span>
      <SaveIndicator />
    </div>
  );
}
