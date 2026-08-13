import { useRef, useState, useEffect, useCallback } from 'react';
import { Stage, Layer } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { useUIStore } from '../../stores/uiStore';
import { useImageStore } from '../../stores/imageStore';
import ImageLayer from './ImageLayer';
import MaskLayer from './MaskLayer';
import DrawingLayer from './DrawingLayer';
import styles from './KonvaStage.module.css';

export default function KonvaStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  const currentImage = useImageStore(s => s.currentImage);
  const zoom = useUIStore(s => s.zoom);
  const offsetX = useUIStore(s => s.offsetX);
  const offsetY = useUIStore(s => s.offsetY);
  const setTransform = useUIStore(s => s.setTransform);

  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const cr = entry.contentRect;
      if (cr.width > 0 && cr.height > 0) {
        setSize({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit image when first loaded
  useEffect(() => {
    if (currentImage && currentImage.width > 0 && currentImage.height > 0) {
      const { fitToScreen } = useUIStore.getState();
      fitToScreen(currentImage.width, currentImage.height, size.width, size.height);
    }
  }, [currentImage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel zoom
  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const { zoom: oldZoom, offsetX: ox, offsetY: oy } = useUIStore.getState();
    const scaleBy = 1.12;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    let newZoom = direction > 0 ? oldZoom * scaleBy : oldZoom / scaleBy;
    newZoom = Math.max(0.1, Math.min(20, newZoom));

    const stagePoint = {
      x: (pointer.x - ox) / oldZoom,
      y: (pointer.y - oy) / oldZoom,
    };
    setTransform(newZoom, pointer.x - stagePoint.x * newZoom, pointer.y - stagePoint.y * newZoom);
  }, [setTransform]);

  // Pan (Ctrl+drag or middle mouse on stage background)
  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const clickedOnStage = e.target === e.target.getStage();
    if (!clickedOnStage) return;
    if (e.evt.ctrlKey || e.evt.metaKey || e.evt.button === 1) {
      isPanning.current = true;
      const pos = stageRef.current?.getPointerPosition();
      if (pos) lastPointer.current = { x: pos.x, y: pos.y };
      e.evt.preventDefault();
    }
  }, []);

  const handleMouseMove = useCallback(() => {
    if (!isPanning.current) return;
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    const dx = pos.x - lastPointer.current.x;
    const dy = pos.y - lastPointer.current.y;
    lastPointer.current = { x: pos.x, y: pos.y };
    const { zoom: z, offsetX: ox, offsetY: oy } = useUIStore.getState();
    setTransform(z, ox + dx, oy + dy);
  }, [setTransform]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  if (!currentImage) {
    return (
      <div ref={containerRef} className={styles.container}>
        <div className={styles.placeholder}>选择一张图像开始标注</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.container}>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        scaleX={zoom}
        scaleY={zoom}
        x={offsetX}
        y={offsetY}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <Layer>
          <ImageLayer />
        </Layer>
        <Layer>
          <MaskLayer />
        </Layer>
        <Layer>
          <DrawingLayer />
        </Layer>
      </Stage>
    </div>
  );
}
