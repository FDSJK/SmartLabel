import { create } from 'zustand';
import { fetchLabels } from '../api/labels';
import type { Label } from '../types/api';

interface LabelState {
  labels: Label[];
  loaded: boolean;
  load: () => Promise<void>;
}

export const useLabelStore = create<LabelState>((set) => ({
  labels: [],
  loaded: false,
  load: async () => {
    const labels = await fetchLabels();
    set({ labels, loaded: true });
  },
}));
