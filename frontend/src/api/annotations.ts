import { apiClient } from './client';
import type { Shape, LabelStatusValue } from '../types/shapes';

export interface AnnotationReadResponse {
  schemaVersion: number;
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  shapes: Shape[];
  labelStatus: Record<string, string>;
  version: number;
}

export interface AnnotationSaveResponse {
  rev: number;
  shapes: Shape[];
  labelStatus: Record<string, string>;
  savedAt: string;
}

export async function fetchAnnotation(imageId: number): Promise<AnnotationReadResponse> {
  return apiClient.get<AnnotationReadResponse>(`/images/${imageId}/annotation`);
}

export async function saveAnnotation(
  imageId: number,
  expectedRev: number,
  shapes: Shape[],
  labelStatus: Record<string, LabelStatusValue>,
): Promise<AnnotationSaveResponse> {
  return apiClient.put<AnnotationSaveResponse>(`/images/${imageId}/annotation`, {
    expectedRev,
    shapes,
    labelStatus,
  });
}
