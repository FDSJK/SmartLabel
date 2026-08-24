import { useEffect, useRef, useState } from 'react';
import { listModels } from '../../api/models';
import { triggerInference, triggerBatchInference, getJob } from '../../api/inference';
import { useImageStore } from '../../stores/imageStore';
import { useBatchStore } from '../../stores/batchStore';
import { useDraftStore } from '../../stores/draftStore';
import type { ModelConfig, InferenceJob } from '../../types/model';

export default function InferencePanel() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  const [job, setJob] = useState<InferenceJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentImage = useImageStore((s) => s.currentImage);
  const currentBatchId = useBatchStore((s) => s.currentBatchId);

  useEffect(() => {
    listModels().then((m) => setModels(m.filter((x) => x.enabled)));
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startPolling = (jobId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const j = await getJob(jobId);
      setJob(j);
      if (j.status === 'done' || j.status === 'failed') {
        if (pollRef.current) clearInterval(pollRef.current);
        setBusy(false);
        if (j.status === 'done') {
          const img = useImageStore.getState().currentImage;
          if (img) useDraftStore.getState().loadDraft(img.id);
        }
      }
    }, 1500);
  };

  const runSingle = async () => {
    if (!modelId || !currentImage) return;
    setBusy(true); setJob(null); setNotice('');
    try {
      const r = await triggerInference(modelId, currentImage.id);
      startPolling(r.jobId);
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
    } catch (e) {
      setBusy(false);
      setNotice(`触发失败：${(e as Error).message}`);
    }
  };

  const statusText = job
    ? { queued: '排队中', running: '推理中', done: '完成', failed: `失败：${job.error}` }[job.status]
    : '';

  return (
    <div>
      <h3>预分割</h3>
      <select value={modelId ?? ''} onChange={(e) => setModelId(Number(e.target.value) || null)}>
        <option value="">选择模型</option>
        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button onClick={runSingle} disabled={!modelId || !currentImage || busy}>推理此图</button>
      <button onClick={runBatch} disabled={!modelId || !currentBatchId || busy}>推理整批</button>
      {statusText && <p>{statusText}</p>}
      {notice && <p>{notice}</p>}
      {job?.status === 'failed' && <button onClick={runSingle}>重试</button>}
    </div>
  );
}
