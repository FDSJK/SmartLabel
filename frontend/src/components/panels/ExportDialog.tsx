import { useState } from 'react';
import { useImageStore } from '../../stores/imageStore';
import { useBatchStore } from '../../stores/batchStore';
import { useUIStore } from '../../stores/uiStore';
import {
  runExport,
  unconfirmedPending,
  type ExportFormat,
  type ExportResponse,
  type PendingItem,
} from '../../api/export';
import styles from './ExportDialog.module.css';

type Scope = 'image' | 'batch' | 'all';

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'image', label: '当前图像' },
  { value: 'batch', label: '当前批次' },
  { value: 'all', label: '全部批次' },
];

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'mask', label: 'PNG 二值 mask' },
  { value: 'coco', label: 'COCO (Polygon + RLE)' },
  { value: 'labelme', label: 'labelme JSON' },
];

type Phase = 'idle' | 'exporting' | 'pending' | 'done' | 'error';

export default function ExportDialog() {
  const close = useUIStore(s => s.closeExportDialog);
  const currentImage = useImageStore(s => s.currentImage);
  const currentBatchId = useBatchStore(s => s.currentBatchId);

  const [scope, setScope] = useState<Scope>('batch');
  const [formats, setFormats] = useState<ExportFormat[]>(['mask', 'coco', 'labelme']);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleFormat(f: ExportFormat) {
    setFormats(prev => (prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]));
  }

  async function doExport(skip: boolean) {
    setPhase('exporting');
    setError(null);
    try {
      const res = await runExport({
        scope,
        imageId: scope === 'image' ? currentImage?.id ?? null : null,
        batchId: scope === 'batch' ? currentBatchId : null,
        formats,
        skipUnconfirmed: skip,
      });
      setResult(res);
      setPhase('done');
    } catch (e) {
      const p = unconfirmedPending(e);
      if (p) {
        setPending(p);
        setPhase('pending');
      } else {
        setError(e instanceof Error ? e.message : '导出失败');
        setPhase('error');
      }
    }
  }

  const canExport =
    formats.length > 0 &&
    phase !== 'exporting' &&
    (scope !== 'image' || currentImage != null) &&
    (scope !== 'batch' || currentBatchId != null);

  return (
    <div className={styles.overlay} onClick={close}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <h2 className={styles.title}>导出标注</h2>

        {phase === 'done' && result ? (
          <div className={styles.body}>
            <p className={styles.success}>
              已导出到 <code>{result.exportDir}</code>
            </p>
            <p className={styles.stats}>
              图像 {result.imageCount} · 标注 {result.annotationCount} · mask {result.maskCount}
            </p>
            {result.pending.length > 0 && (
              <p className={styles.warn}>跳过未确认标签（涉及 {result.pending.length} 张图）</p>
            )}
            {result.errors.length > 0 && (
              <p className={styles.warn}>
                {result.errors.length} 个错误：{result.errors.map(e => e.file).join('、')}
              </p>
            )}
            <div className={styles.actions}>
              <button className={styles.primary} onClick={close}>完成</button>
            </div>
          </div>
        ) : phase === 'pending' ? (
          <div className={styles.body}>
            <p className={styles.warn}>以下图像存在未确认标签：</p>
            <ul className={styles.pendingList}>
              {pending.map(p => (
                <li key={p.image}>
                  {p.image}：{p.labels.join('、')}
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <button className={styles.primary} onClick={() => doExport(true)}>忽略并继续导出</button>
              <button className={styles.secondary} onClick={() => setPhase('idle')}>返回</button>
            </div>
          </div>
        ) : (
          <div className={styles.body}>
            <div className={styles.field}>
              <span className={styles.label}>范围</span>
              {SCOPE_OPTIONS.map(o => (
                <label key={o.value} className={styles.radio}>
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === o.value}
                    disabled={
                      (o.value === 'image' && currentImage == null) ||
                      (o.value === 'batch' && currentBatchId == null)
                    }
                    onChange={() => setScope(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </div>

            <div className={styles.field}>
              <span className={styles.label}>格式</span>
              {FORMAT_OPTIONS.map(o => (
                <label key={o.value} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={formats.includes(o.value)}
                    onChange={() => toggleFormat(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </div>

            {error && <p className={styles.warn}>{error}</p>}

            <div className={styles.actions}>
              <button className={styles.primary} disabled={!canExport} onClick={() => doExport(false)}>
                {phase === 'exporting' ? '导出中…' : '开始导出'}
              </button>
              <button className={styles.secondary} onClick={close}>取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
