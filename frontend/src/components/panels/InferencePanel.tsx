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
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  // 一次性提示：5 秒后自动消失
  const flashNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 5000);
  };

  const startPolling = (jobId: number, imageId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const j = await getJob(jobId);
      useInferenceStore.getState().setJob(j);
      if (j.status === 'queued' || j.status === 'running') {
        setJob(j);
        return;
      }
      // done / failed
      if (pollRef.current) clearInterval(pollRef.current);
      setBusy(false);
      if (j.status === 'done') {
        useDraftStore.getState().loadDraft(imageId);
        setJob(null);
        flashNotice('推理完成');
      } else {
        setJob(j); // 失败：保留，显示错误 + 重试
      }
    }, 1500);
  };

  const runSingle = async () => {
    if (!modelId || !currentImage) return;
    setBusy(true); setJob(null); setNotice('');
    try {
      const r = await triggerInference(modelId, currentImage.id);
      startPolling(r.jobId, currentImage.id);
    } catch (e) {
      setBusy(false);
      flashNotice(`触发失败：${(e as Error).message}`);
    }
  };

  const runBatch = async () => {
    if (!modelId || !currentBatchId) return;
    setBusy(true); setNotice('');
    try {
      const r = await triggerBatchInference(modelId, currentBatchId);
      setBusy(false);
      flashNotice(`已排队 ${r.queued} 张，后台推理中`);
      useInferenceStore.getState().startPolling(currentBatchId);
    } catch (e) {
      setBusy(false);
      flashNotice(`触发失败：${(e as Error).message}`);
    }
  };

  const statusText = job
    ? job.status === 'failed' ? `失败：${job.error}`
    : job.status === 'queued' ? '排队中'
    : job.status === 'running' ? '推理中'
    : ''
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
