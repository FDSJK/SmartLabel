import { useEffect, useRef, useState } from 'react';
import { listModels } from '../../api/models';
import { triggerInference, triggerBatchInference, getJob } from '../../api/inference';
import { useImageStore } from '../../stores/imageStore';
import { useBatchStore } from '../../stores/batchStore';
import { useDraftStore } from '../../stores/draftStore';
import { useInferenceStore } from '../../stores/inferenceStore';
import type { ModelConfig, InferenceJob } from '../../types/model';
import styles from './InferencePanel.module.css';

export default function InferencePanel() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  const [job, setJob] = useState<InferenceJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentImage = useImageStore((s) => s.currentImage);
  const currentBatchId = useBatchStore((s) => s.currentBatchId);
  const lockedByMe = useImageStore((s) => s.lockedByMe);
  const draftStatus = useDraftStore((s) => s.status);
  const draftMeta = useDraftStore((s) => s.draftMeta);

  useEffect(() => {
    listModels().then((m) => setModels(m.filter((x) => x.enabled))).catch(() => {});
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (batchPollRef.current) clearInterval(batchPollRef.current);
  }, []);

  const startPolling = (jobId: number, imageId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const j = await getJob(jobId);
      setJob(j);
      useInferenceStore.getState().setJob(j);
      if (j.status === 'done' || j.status === 'failed') {
        if (pollRef.current) clearInterval(pollRef.current);
        setBusy(false);
        if (j.status === 'done') {
          useDraftStore.getState().loadDraft(imageId);
        }
      }
    }, 1500);
  };

  const startBatchPolling = (batchId: number) => {
    if (batchPollRef.current) clearInterval(batchPollRef.current);
    const tick = async () => {
      const pending = await useInferenceStore.getState().loadBatchJobs(batchId);
      if (!pending && batchPollRef.current) clearInterval(batchPollRef.current);
    };
    tick();
    batchPollRef.current = setInterval(tick, 3000);
  };

  const runSingle = async () => {
    if (!modelId || !currentImage) return;
    setBusy(true); setJob(null); setNotice('');
    try {
      const r = await triggerInference(modelId, currentImage.id);
      startPolling(r.jobId, currentImage.id);
    } catch (e) {
      setBusy(false);
      setNotice(`触发失败：${(e as Error).message}`);
    }
  };

  const runBatch = async () => {
    if (!modelId || !currentBatchId) return;
    setBusy(true); setNotice('');
    try {
      const r = await triggerBatchInference(modelId, currentBatchId);
      setBusy(false);
      setNotice(`已排队 ${r.queued} 张，后台推理中`);
      startBatchPolling(currentBatchId);
    } catch (e) {
      setBusy(false);
      setNotice(`触发失败：${(e as Error).message}`);
    }
  };

  const statusText = job
    ? { queued: '排队中', running: '推理中', done: '完成', failed: `失败：${job.error}` }[job.status]
    : '';

  return (
    <div className={styles.section}>
      <h3 className={styles.title}>预分割</h3>
      <select className={styles.select} value={modelId ?? ''} onChange={(e) => setModelId(Number(e.target.value) || null)}>
        <option value="">选择模型</option>
        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <div className={styles.btnRow}>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={runSingle} disabled={!modelId || !currentImage || busy}>推理此图</button>
        <button className={styles.btn} onClick={runBatch} disabled={!modelId || !currentBatchId || busy}>推理整批</button>
      </div>
      {statusText && <p className={styles.status}>{statusText}</p>}
      {notice && <p className={styles.status}>{notice}</p>}
      {job?.status === 'failed' && <button className={styles.btn} onClick={runSingle}>重试</button>}

      {draftStatus === 'ready' && currentImage && (
        <div className={styles.draftBox}>
          <p className={styles.draftLabel}>草稿：{draftMeta?.modelName ?? '模型预分割'}</p>
          <div className={styles.btnRow}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => useDraftStore.getState().acceptDraft(currentImage.id)} disabled={!lockedByMe}>接受</button>
            <button className={styles.btn} onClick={() => useDraftStore.getState().rejectDraft(currentImage.id)} disabled={!lockedByMe}>拒绝</button>
          </div>
          {!lockedByMe && <p className={styles.status}>只读模式，无法接受/拒绝</p>}
        </div>
      )}
    </div>
  );
}
