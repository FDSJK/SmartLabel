import { useEffect, useRef, useState } from 'react';
import { Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import { useImageStore } from '../../stores/imageStore';
import { useUIStore } from '../../stores/uiStore';
import { apiClient } from '../../api/client';

/**
 * Loads an image file from the backend (requires auth) and renders
 * it as a Konva Image. Re-loads whenever currentImage.id changes.
 */
export default function ImageLayer() {
  const currentImage = useImageStore(s => s.currentImage);
  const contrast = useUIStore(s => s.contrast);
  const enhanced = useUIStore(s => s.enhanced);
  const imageRef = useRef<Konva.Image>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!currentImage) {
      setImageElement(null);
      return;
    }

    let cancelled = false;

    async function load() {
      setError(false);
      setImageElement(null);

      try {
        const token = apiClient.getToken();
        const endpoint = enhanced
          ? `/api/images/${currentImage!.id}/file/enhanced`
          : `/api/images/${currentImage!.id}/file`;
        const res = await fetch(endpoint, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const blob = await res.blob();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        const img = new window.Image();
        img.onload = () => {
          if (cancelled) return;
          URL.revokeObjectURL(url);
          setImageElement(img);
        };
        img.onerror = () => {
          if (cancelled) return;
          URL.revokeObjectURL(url);
          setError(true);
        };
        img.src = url;
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [currentImage?.id, enhanced]);

  // 对比度滤镜：仅作用于底图（不影响 mask / 标注层）。contrast 为 0 时恢复原图。
  useEffect(() => {
    const node = imageRef.current;
    if (!node || !imageElement) return;
    if (contrast !== 0) {
      node.filters([Konva.Filters.Contrast]);
      node.contrast(contrast);
      node.cache();
    } else {
      node.filters([]);
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [contrast, imageElement]);

  if (error) {
    return null; // Stage will show empty — error is logged above
  }

  if (!imageElement) {
    return null;
  }

  return <KonvaImage ref={imageRef} image={imageElement} listening={false} />;
}
