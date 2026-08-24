import { create } from 'zustand';
import { listJobs } from '../api/inference';
import type { InferenceJob } from '../types/model';

interface InferenceState {
  /** image_id → 该图最新的推理任务 */
  jobsByImage: Record<number, InferenceJob>;
  /** 加载某批次的推理任务状态，返回是否仍有排队/运行中的任务 */
  loadBatchJobs: (batchId: number) => Promise<boolean>;
  setJob: (job: InferenceJob) => void;
  clear: () => void;
  /** 开始轮询某批次（幂等），直到没有排队/运行中的任务为止；不随组件卸载而停止 */
  startPolling: (batchId: number) => void;
  stopPolling: () => void;
}

// 模块级定时器：轮询不依赖任何组件生命周期
let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useInferenceStore = create<InferenceState>((set, get) => ({
  jobsByImage: {},

  loadBatchJobs: async (batchId) => {
    const jobs = await listJobs(batchId);
    const map: Record<number, InferenceJob> = {};
    for (const j of jobs) {
      if (!(j.image_id in map)) map[j.image_id] = j; // 后端按 id 倒序，首个即最新
    }
    set({ jobsByImage: map });
    return jobs.some((j) => j.status === 'queued' || j.status === 'running');
  },

  setJob: (job) => set((s) => ({ jobsByImage: { ...s.jobsByImage, [job.image_id]: job } })),

  clear: () => set({ jobsByImage: {} }),

  startPolling: (batchId) => {
    if (pollTimer) clearInterval(pollTimer);
    const tick = async () => {
      const pending = await get().loadBatchJobs(batchId);
      if (!pending && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    tick();
    pollTimer = setInterval(tick, 3000);
  },

  stopPolling: () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  },
}));
