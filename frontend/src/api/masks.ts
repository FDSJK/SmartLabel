import { apiClient } from './client';
import type { Shape, LabelStatusValue } from '../types/shapes';

export interface MaskExportResponse {
  saved: string[];
  errors: { label: string; error: string }[];
}

export async function exportImageMask(
  imageId: number,
  shapes: Shape[],
  labelStatus: Record<string, LabelStatusValue>,
): Promise<MaskExportResponse> {
  return apiClient.post<MaskExportResponse>(`/images/${imageId}/export-mask`, {
    shapes,
    labelStatus,
  });
}
