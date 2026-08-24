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
}

export const useInferenceStore = create<InferenceState>((set) => ({
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
}));
