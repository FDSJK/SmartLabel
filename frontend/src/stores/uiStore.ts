import { create } from 'zustand';
import type { SaveStatus } from '../types/shapes';

interface UIState {
  zoom: number;
  offsetX: number;
  offsetY: number;
  showMask: boolean;
  // 草稿层显隐
  showDraft: boolean;
  showFill: boolean;
  // 按标签显隐（标签名 → 是否隐藏）
  hiddenLabels: Record<string, boolean>;
  saveStatus: SaveStatus;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  exportDialogOpen: boolean;

  setTransform: (zoom: number, offsetX: number, offsetY: number) => void;
  fitToScreen: (imageWidth: number, imageHeight: number, viewWidth: number, viewHeight: number) => void;
  setShowMask: (show: boolean) => void;
  setShowDraft: (show: boolean) => void;
  toggleFill: () => void;
  toggleLabelVisibility: (label: string) => void;
  setSaveStatus: (status: SaveStatus) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  openExportDialog: () => void;
  closeExportDialog: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  showMask: true,
  showDraft: true,
  showFill: true,
  hiddenLabels: {},
  saveStatus: 'saved',
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  exportDialogOpen: false,

  setTransform: (zoom, offsetX, offsetY) => set({ zoom, offsetX, offsetY }),

  fitToScreen: (imageWidth, imageHeight, viewWidth, viewHeight) => {
    if (imageWidth === 0 || imageHeight === 0) return;
    const padding = 40;
    const scaleX = (viewWidth - padding) / imageWidth;
    const scaleY = (viewHeight - padding) / imageHeight;
    const zoom = Math.min(scaleX, scaleY, 1);
    const offsetX = (viewWidth - imageWidth * zoom) / 2;
    const offsetY = (viewHeight - imageHeight * zoom) / 2;
    set({ zoom, offsetX, offsetY });
  },

  setShowMask: (show) => set({ showMask: show }),
  setShowDraft: (show) => set({ showDraft: show }),
  toggleFill: () => set(s => ({ showFill: !s.showFill })),
  toggleLabelVisibility: (label) => set(s => ({ hiddenLabels: { ...s.hiddenLabels, [label]: !s.hiddenLabels[label] } })),
  setSaveStatus: (status) => set({ saveStatus: status }),
  toggleLeftPanel: () => set(s => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),
  toggleRightPanel: () => set(s => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  openExportDialog: () => set({ exportDialogOpen: true }),
  closeExportDialog: () => set({ exportDialogOpen: false }),
}));
