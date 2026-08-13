import { useEffect, useState } from 'react';
import { Image as KonvaImage } from 'react-konva';
import { useImageStore } from '../../stores/imageStore';
import { apiClient } from '../../api/client';

/**
 * Loads an image file from the backend (requires auth) and renders
 * it as a Konva Image. Re-loads whenever currentImage.id changes.
 */
export default function ImageLayer() {
  const currentImage = useImageStore(s => s.currentImage);
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
        const res = await fetch(`/api/images/${currentImage!.id}/file`, {
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
  }, [currentImage?.id]);

  if (error) {
    return null; // Stage will show empty — error is logged above
  }

  if (!imageElement) {
    return null;
  }

  return <KonvaImage image={imageElement} listening={false} />;
}
