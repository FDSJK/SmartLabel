import { useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { useImageStore } from '../../stores/imageStore';
import { useBatchStore } from '../../stores/batchStore';
import { useLabelStore } from '../../stores/labelStore';
import { exportImageMask } from '../../api/masks';
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
  const drawingPoints = useEditorStore(s => s.drawingPoints);
  const finishDrawing = useEditorStore(s => s.finishDrawing);
  const cancelDrawing = useEditorStore(s => s.cancelDrawing);
  const shapeCount = useEditorStore(s => s.shapes.length);
  const zoom = useUIStore(s => s.zoom);
  const showFill = useUIStore(s => s.showFill);
  const toggleFill = useUIStore(s => s.toggleFill);
  const contrast = useUIStore(s => s.contrast);
  const setContrast = useUIStore(s => s.setContrast);
  const enhanced = useUIStore(s => s.enhanced);
  const toggleEnhanced = useUIStore(s => s.toggleEnhanced);
  const currentImage = useImageStore(s => s.currentImage);
  const lockedByMe = useImageStore(s => s.lockedByMe);
  const labelStatus = useEditorStore(s => s.labelStatus);
  const shapes = useEditorStore(s => s.shapes);
  const labels = useLabelStore(s => s.labels);
  const images = useBatchStore(s => s.images);
  const loadingImage = useImageStore(s => s.loading);
  const goPrevImage = useImageStore(s => s.goPrevImage);
  const goNextImage = useImageStore(s => s.goNextImage);
  const [maskStatus, setMaskStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [maskError, setMaskError] = useState<string | null>(null);

  const hasPresentOrAbsent = Object.values(labelStatus).some(v => v === 'present' || v === 'absent');
  const canExport = currentImage !== null && lockedByMe && hasPresentOrAbsent;

  const imageIndex = currentImage ? images.findIndex(i => i.id === currentImage.id) : -1;
  const hasPrev = imageIndex > 0;
  const hasNext = imageIndex >= 0 && imageIndex < images.length - 1;

  async function handleExportMask() {
    if (!currentImage) return;
    // 与右侧「标签状态」面板显示一致：缺失条目的标签也视为待定（面板用 || 'pending' 兜底显示）
    const pending = labels
      .filter(l => l.enabled && (labelStatus[l.name] ?? 'pending') === 'pending')
      .map(l => l.name);
    if (pending.length > 0) {
      const ok = window.confirm(`存在待定标签：${pending.join('、')}。是否忽略待定标签继续保存？`);
      if (!ok) return;
    }
    setMaskStatus('exporting');
    setMaskError(null);
    try {
      const res = await exportImageMask(currentImage.id, shapes, labelStatus);
      if (res.errors.length > 0) {
        setMaskError(`部分标签保存失败：${res.errors.map(e => e.label).join('、')}`);
        setMaskStatus('error');
        window.setTimeout(() => setMaskStatus('idle'), 4000);
      } else {
        setMaskStatus('done');
        window.setTimeout(() => setMaskStatus('idle'), 2500);
      }
    } catch {
      setMaskError('保存 mask 失败');
      setMaskStatus('error');
      window.setTimeout(() => setMaskStatus('idle'), 4000);
    }
  }

  return (
    <div className={styles.bar}>
      <button
        className={styles.btn}
        disabled={!hasPrev || loadingImage}
        onClick={goPrevImage}
      >
        ‹
        <span className={styles.tooltip}>上一张 ←</span>
      </button>
      <span className={styles.metric}>
        {currentImage && imageIndex >= 0 ? `${imageIndex + 1}/${images.length}` : '-'}
      </span>
      <button
        className={styles.btn}
        disabled={!hasNext || loadingImage}
        onClick={goNextImage}
      >
        ›
        <span className={styles.tooltip}>下一张 →</span>
      </button>

      <span className={styles.sep} />

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

      {drawingPoints !== null && (
        <>
          <button
            className={`${styles.btn} ${styles.btnFinish}`}
            disabled={drawingPoints.length < 3}
            onClick={finishDrawing}
          >
            ✓ 闭合
            <span className={styles.tooltip}>闭合当前多边形/曲线（至少 3 点）</span>
          </button>
          <button
            className={`${styles.btn} ${styles.btnCancel}`}
            onClick={cancelDrawing}
          >
            ✕ 取消绘制
            <span className={styles.tooltip}>取消当前绘制（Esc 在全屏时会被 Safari 占用）</span>
          </button>
        </>
      )}

      <span className={styles.sep} />

      <button
        className={styles.btn}
        onClick={toggleFill}
      >
        {showFill ? '▣' : '□'}
        <span className={styles.tooltip}>{showFill ? '隐藏填充' : '显示填充'}</span>
      </button>

      <span className={styles.sep} />

      <label className={styles.contrast} title="调整原图对比度">
        <span className={styles.contrastLabel}>对比度</span>
        <input
          type="range"
          min={-100}
          max={100}
          step={1}
          value={contrast}
          onChange={(e) => setContrast(Number(e.target.value))}
          onDoubleClick={() => setContrast(0)}
        />
        <span className={styles.contrastValue}>{contrast > 0 ? `+${contrast}` : contrast}</span>
      </label>
      {contrast !== 0 && (
        <button className={styles.btn} onClick={() => setContrast(0)} title="重置对比度">
          ↺
        </button>
      )}

      <button
        className={`${styles.btn} ${enhanced ? styles.btnActive : ''}`}
        onClick={toggleEnhanced}
        title={enhanced ? '关闭图像增强' : '一键图像增强（CLAHE）'}
      >
        ✨
      </button>

      <span className={styles.sep} />

      <span className={styles.metric}>{shapeCount} 标注</span>
      <span className={styles.metric}>{Math.round(zoom * 100)}%</span>
      <button
        className={styles.btn}
        disabled={!canExport || maskStatus === 'exporting'}
        onClick={handleExportMask}
      >
        {maskStatus === 'exporting' ? '⏳' : maskStatus === 'done' ? '✓' : '⬇'}
        <span className={styles.tooltip}>
          {maskStatus === 'done' ? '已保存 mask' : maskStatus === 'error' ? (maskError ?? '保存 mask 失败') : '保存 mask'}
        </span>
      </button>
      <SaveIndicator />
    </div>
  );
}
