import { useRef, useCallback, useState } from 'react';
import { Circle, Line, Rect, Group } from 'react-konva';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { useLabelStore } from '../../stores/labelStore';
import { useImageStore } from '../../stores/imageStore';
import { distance, pointToSegmentDistance, isPointInShape } from '../../utils/geometry';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Shape } from '../../types/shapes';

const VERTEX_RADIUS = 4;
const VERTEX_HIT_RADIUS = 8;
const FREIHAND_MIN_DIST = 5;
const DRAG_THRESHOLD = 10;
const DBLCLICK_HIT_RADIUS = 24;

/** Convert stage pointer position to image coordinates */
function toImageCoords(stageX: number, stageY: number): [number, number] {
  const { zoom, offsetX, offsetY } = useUIStore.getState();
  return [(stageX - offsetX) / zoom, (stageY - offsetY) / zoom];
}

/** Find nearest vertex across shapes */
function findNearestVertex(
  ix: number, iy: number, shapes: Shape[], threshold: number,
): { shapeId: string; vertexIndex: number } | null {
  let best = null;
  let bestDist = threshold;
  for (const shape of shapes) {
    for (let i = 0; i < shape.points.length; i++) {
      const d = distance(ix, iy, shape.points[i][0], shape.points[i][1]);
      if (d < bestDist) { bestDist = d; best = { shapeId: shape.id, vertexIndex: i }; }
    }
  }
  return best;
}

/** Find nearest shape by edge distance */
function findNearestShape(
  ix: number, iy: number, shapes: Shape[], threshold: number,
): string | null {
  let best: string | null = null;
  let bestDist = threshold;
  for (const shape of shapes) {
    for (let i = 0; i < shape.points.length; i++) {
      const a = shape.points[i];
      const b = shape.points[(i + 1) % shape.points.length];
      const d = pointToSegmentDistance(ix, iy, a[0], a[1], b[0], b[1]);
      if (d < bestDist) { bestDist = d; best = shape.id; }
    }
  }
  return best;
}

export default function DrawingLayer() {
  const currentTool = useEditorStore(s => s.currentTool);
  const selectedLabel = useEditorStore(s => s.selectedLabel);
  const drawingPoints = useEditorStore(s => s.drawingPoints);
  const shapes = useEditorStore(s => s.shapes);
  const selectedShapeId = useEditorStore(s => s.selectedShapeId);
  const showDraft = useUIStore(s => s.showDraft);
  const labels = useLabelStore(s => s.labels);
  const currentImage = useImageStore(s => s.currentImage);

  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);

  // Freehand tracking
  const freehandActive = useRef(false);
  const lastFreehandPoint = useRef<[number, number] | null>(null);

  // Boolean op (add/cut) freehand tracking
  const boolDrawing = useRef(false);
  const lastBoolPoint = useRef<[number, number] | null>(null);

  // Select mode: drag tracking
  const dragRef = useRef<{
    type: 'vertex' | 'shape';
    shapeId: string;
    vertexIndex?: number;
    startPoints: number[][];
    startHoles?: number[][][];
    startPos: [number, number];
  } | null>(null);
  const mousedownPos = useRef<[number, number] | null>(null);
  const dragStarted = useRef(false);

  const [editHoverVertex, setEditHoverVertex] = useState<{
    shapeId: string;
    vertexIndex: number;
  } | null>(null);

  // Pan tracking (screen coords)
  const isPanning = useRef(false);
  const lastPanPointer = useRef({ x: 0, y: 0 });

  const isDrawing = currentTool === 'polygon' || currentTool === 'freehand';
  const isSelecting = currentTool === 'select';
  const isAdding = currentTool === 'add';
  const isCutting = currentTool === 'cut';
  const drawingActive = selectedLabel !== null && isDrawing && currentImage !== null && showDraft;
  const editActive = isSelecting && currentImage !== null;
  const boolOpActive = (isAdding || isCutting) && currentImage !== null;
  const boolCanDraw = boolOpActive && selectedShapeId !== null;

  // --- Mouse handlers ---

  const handleMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;

      const panKey = e.evt.ctrlKey || e.evt.metaKey || e.evt.button === 1;
      if (panKey && (drawingActive || editActive || boolOpActive)) {
        isPanning.current = true;
        lastPanPointer.current = { x: pos.x, y: pos.y };
        e.evt.preventDefault();
        return;
      }

      const [ix, iy] = toImageCoords(pos.x, pos.y);

      // Drawing modes (polygon + freehand)
      if (drawingActive) {
        if (currentTool === 'polygon' && e.evt.button === 0) {
          const store = useEditorStore.getState();
          if (store.drawingPoints === null) store.startDrawing();
          store.addDrawingPoint(ix, iy);
          e.evt.preventDefault();
          return;
        }
        if (currentTool === 'freehand' && e.evt.button === 0) {
          const store = useEditorStore.getState();
          if (store.drawingPoints === null) store.startDrawing();
          store.addDrawingPoint(ix, iy);
          freehandActive.current = true;
          lastFreehandPoint.current = [ix, iy];
          e.evt.preventDefault();
          return;
        }
      }

      // Boolean op (add/cut) freehand drawing
      // NO preventDefault — it blocks native dblclick (needed for double-click selection)
      if (boolCanDraw && e.evt.button === 0) {
        const store = useEditorStore.getState();
        if (store.drawingPoints === null) store.startDrawing();
        store.addDrawingPoint(ix, iy);
        boolDrawing.current = true;
        lastBoolPoint.current = [ix, iy];
        return;
      }

      // Select mode (or add/cut without target): record position for potential drag
      // NO preventDefault — it blocks native dblclick
      if ((editActive || boolOpActive) && e.evt.button === 0) {
        mousedownPos.current = [ix, iy];
        dragStarted.current = false;
        dragRef.current = null;
      }
    },
    [currentTool, drawingActive, editActive, boolOpActive, boolCanDraw],
  );

  const handleMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;

      // Pan
      if (isPanning.current) {
        const dx = pos.x - lastPanPointer.current.x;
        const dy = pos.y - lastPanPointer.current.y;
        lastPanPointer.current = { x: pos.x, y: pos.y };
        const { zoom, offsetX, offsetY, setTransform } = useUIStore.getState();
        setTransform(zoom, offsetX + dx, offsetY + dy);
        return;
      }

      const [ix, iy] = toImageCoords(pos.x, pos.y);
      setCursorPos([ix, iy]);

      // Freehand sampling (regular drawing)
      if (currentTool === 'freehand' && freehandActive.current && drawingActive) {
        if (lastFreehandPoint.current) {
          const dx = ix - lastFreehandPoint.current[0];
          const dy = iy - lastFreehandPoint.current[1];
          if (Math.sqrt(dx * dx + dy * dy) >= FREIHAND_MIN_DIST) {
            useEditorStore.getState().addDrawingPoint(ix, iy);
            lastFreehandPoint.current = [ix, iy];
          }
        }
        return;
      }

      // Boolean op freehand sampling (add/cut)
      if (boolDrawing.current && lastBoolPoint.current) {
        const dx = ix - lastBoolPoint.current[0];
        const dy = iy - lastBoolPoint.current[1];
        if (Math.sqrt(dx * dx + dy * dy) >= FREIHAND_MIN_DIST) {
          useEditorStore.getState().addDrawingPoint(ix, iy);
          lastBoolPoint.current = [ix, iy];
        }
        return;
      }

      // Select mode: drag shape/vertex, or pan if nothing hit
      if (isSelecting && mousedownPos.current && !dragStarted.current) {
        const [sx, sy] = mousedownPos.current;
        if (Math.sqrt((ix - sx) ** 2 + (iy - sy) ** 2) >= DRAG_THRESHOLD) {
          dragStarted.current = true;
          let hit = false;

          if (selectedShapeId) {
            const selShape = shapes.find(s => s.id === selectedShapeId);
            if (selShape) {
              // Check vertex
              const v = findNearestVertex(sx, sy, [selShape], VERTEX_HIT_RADIUS);
              if (v) {
                hit = true;
                dragRef.current = {
                  type: 'vertex', shapeId: v.shapeId, vertexIndex: v.vertexIndex,
                  startPoints: selShape.points.map(p => [...p]), startPos: [ix, iy],
                };
              } else if (isPointInShape(sx, sy, selShape.points, selShape.holes ?? [])) {
                // Point inside shape → move entire shape
                hit = true;
                dragRef.current = {
                  type: 'shape', shapeId: selShape.id,
                  startPoints: selShape.points.map(p => [...p]),
                  startHoles: (selShape.holes ?? []).map(h => h.map(p => [...p])),
                  startPos: [ix, iy],
                };
              }
            }
          }

          if (hit) return;

          // Nothing hit — start panning instead
          isPanning.current = true;
          lastPanPointer.current = { x: pos.x, y: pos.y };
          mousedownPos.current = null;
          return;
        }
      }

      // Continue drag
      if (isSelecting && dragRef.current) {
        const d = dragRef.current;
        const dx = ix - d.startPos[0];
        const dy = iy - d.startPos[1];
        if (d.type === 'vertex' && d.vertexIndex !== undefined) {
          const np = d.startPoints.map(p => [...p]);
          np[d.vertexIndex][0] += dx;
          np[d.vertexIndex][1] += dy;
          useEditorStore.getState().updateShape(d.shapeId, np);
        } else if (d.type === 'shape') {
          const np = d.startPoints.map(p => [p[0] + dx, p[1] + dy]);
          const nh = (d.startHoles ?? []).map(h => h.map(p => [p[0] + dx, p[1] + dy]));
          useEditorStore.getState().updateShape(d.shapeId, np, nh);
        }
        return;
      }

      // Hover detection on selected shape vertices
      if (isSelecting && !dragRef.current && selectedShapeId) {
        const sel = shapes.find(s => s.id === selectedShapeId);
        if (sel) {
          const v = findNearestVertex(ix, iy, [sel], VERTEX_HIT_RADIUS);
          setEditHoverVertex(v ? { shapeId: v.shapeId, vertexIndex: v.vertexIndex } : null);
        }
      }
    },
    [currentTool, drawingActive, isSelecting, shapes, selectedShapeId],
  );

  const handleMouseUp = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (isPanning.current) {
        isPanning.current = false;
        e.evt.preventDefault();
        return;
      }
      if (currentTool === 'freehand' && freehandActive.current) {
        freehandActive.current = false;
        lastFreehandPoint.current = null;
        e.evt.preventDefault();
      }

      // Boolean op: apply
      if (boolDrawing.current) {
        boolDrawing.current = false;
        lastBoolPoint.current = null;
        const store = useEditorStore.getState();
        const pts = store.drawingPoints;
        if (pts && pts.length >= 3) {
          if (isAdding) store.applyAdd(pts);
          else if (isCutting) store.applyCut(pts);
        }
        store.cancelDrawing();
        setCursorPos(null);
        e.evt.preventDefault();
        return;
      }

      // End drag / clear mousedown
      dragRef.current = null;
      mousedownPos.current = null;
      dragStarted.current = false;
    },
    [currentTool, isAdding, isCutting],
  );

  // --- Double-click: select shape (on Rect) ---
  const handleDblClick = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      // Double-click selection works in select / add / cut modes
      if (!isSelecting && !isAdding && !isCutting) return;

      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;

      const [ix, iy] = toImageCoords(pos.x, pos.y);

      // Cancel any pending drag
      mousedownPos.current = null;
      dragStarted.current = false;
      dragRef.current = null;

      const store = useEditorStore.getState();
      const currentShapes = store.shapes;

      // 1) Check vertices
      const v = findNearestVertex(ix, iy, currentShapes, DBLCLICK_HIT_RADIUS);
      if (v) {
        store.selectShape(v.shapeId);
        return;
      }
      // 2) Check edges
      const edgeId = findNearestShape(ix, iy, currentShapes, DBLCLICK_HIT_RADIUS);
      if (edgeId) {
        store.selectShape(edgeId);
        return;
      }
      // 3) Check if point is inside any shape
      for (const shape of currentShapes) {
        if (isPointInShape(ix, iy, shape.points, shape.holes ?? [])) {
          store.selectShape(shape.id);
          return;
        }
      }
      // Double-click on empty → deselect
      store.selectShape(null);
    },
    [isSelecting, isAdding, isCutting],
  );

  const handleContextMenu = useCallback(
    (e: KonvaEventObject<PointerEvent>) => {
      if (!drawingActive) return;
      e.evt.preventDefault();
      const store = useEditorStore.getState();
      const pts = store.drawingPoints;
      if (!pts || pts.length < 3) { store.cancelDrawing(); return; }
      store.finishDrawing();
      setCursorPos(null);
    },
    [drawingActive],
  );

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    freehandActive.current = false;
    boolDrawing.current = false;
    lastBoolPoint.current = null;
    dragRef.current = null;
    mousedownPos.current = null;
    dragStarted.current = false;
  }, []);

  // --- Render ---

  const labelColor = selectedLabel
    ? (labels.find(l => l.name === selectedLabel)?.color || '#00bcd4')
    : '#00bcd4';

  const previewFlat = drawingPoints ? drawingPoints.flat() : [];
  const showCursorPreview = drawingActive && currentTool === 'polygon' && drawingPoints && drawingPoints.length > 0;
  const previewWithCursor = showCursorPreview && cursorPos
    ? [...previewFlat, cursorPos[0], cursorPos[1]]
    : previewFlat;

  const selectedShape = selectedShapeId
    ? (shapes.find(s => s.id === selectedShapeId) ?? null)
    : null;

  // Highlight the selected shape in its own label color, not a fixed cyan
  const selectedShapeColor = selectedShape
    ? (labels.find(l => l.name === selectedShape.label)?.color || '#00e5ff')
    : '#00e5ff';

  const imgW = currentImage?.width || 4096;
  const imgH = currentImage?.height || 4096;

  return (
    <>
      {(drawingActive || editActive || boolOpActive) && (
        <Rect
          x={-100} y={-100}
          width={imgW + 200} height={imgH + 200}
          fill="rgba(0,0,0,0.001)"
          listening={true}
          perfectDrawEnabled={false}
          shadowEnabled={false}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
          onDblClick={handleDblClick}
        />
      )}

      {/* Drawing previews (polygon + freehand) */}
      {drawingActive && previewWithCursor.length >= 4 && (
        <Line
          points={previewWithCursor}
          stroke={labelColor}
          strokeWidth={2}
          dash={showCursorPreview && cursorPos ? [6, 4] : undefined}
          tension={currentTool === 'freehand' ? 0.5 : 0}
          lineCap="round" lineJoin="round"
          listening={false}
        />
      )}

      {/* Boolean op preview (add/cut) */}
      {boolDrawing.current && previewFlat.length >= 4 && (
        <Line
          points={previewFlat}
          stroke={isAdding ? '#4caf50' : '#f44336'}
          strokeWidth={2}
          tension={0.5}
          lineCap="round" lineJoin="round"
          dash={[8, 4]}
          listening={false}
        />
      )}

      {drawingActive && currentTool === 'polygon' && drawingPoints &&
        drawingPoints.map(([x, y], i) => (
          <Circle key={`draw-${i}`} x={x} y={y}
            radius={VERTEX_RADIUS} fill="white" stroke={labelColor}
            strokeWidth={2} listening={false} />
        ))}

      {drawingActive && currentTool === 'freehand' && drawingPoints && drawingPoints.length > 1 && (
        <>
          <Circle x={drawingPoints[0][0]} y={drawingPoints[0][1]}
            radius={VERTEX_RADIUS + 1} fill="white" stroke={labelColor}
            strokeWidth={2} listening={false} />
          <Circle x={drawingPoints[drawingPoints.length - 1][0]}
            y={drawingPoints[drawingPoints.length - 1][1]}
            radius={VERTEX_RADIUS + 1} fill={labelColor} stroke="white"
            strokeWidth={1.5} listening={false} />
        </>
      )}

      {/* Selected shape outline — visible in select / add / cut modes */}
      {selectedShape && (isSelecting || isAdding || isCutting) && (
        <Line
          points={selectedShape.points.flat()}
          closed
          stroke={selectedShapeColor}
          strokeWidth={4}
          dash={[6, 3]}
          lineJoin="round"
          shadowColor={selectedShapeColor}
          shadowBlur={10}
          listening={false}
        />
      )}

      {/* Select: vertex handles */}
      {isSelecting && selectedShape &&
        selectedShape.points.map(([x, y], i) => {
          const hovered = editHoverVertex?.shapeId === selectedShape.id &&
            editHoverVertex.vertexIndex === i;
          return (
            <Circle key={`v-${i}`} x={x} y={y}
              radius={hovered ? VERTEX_RADIUS + 2 : VERTEX_RADIUS}
              fill="white" stroke={selectedShapeColor}
              strokeWidth={hovered ? 3 : 2}
              listening={false} />
          );
        })}

      {/* Select: delete button */}
      {isSelecting && selectedShape && (() => {
        const pts = selectedShape.points;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of pts) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        const btnR = 10;
        return (
          <Group x={(minX + maxX) / 2} y={minY - btnR - 6}
            onClick={() => { useEditorStore.getState().deleteSelectedShape(); }}
            onTap={() => { useEditorStore.getState().deleteSelectedShape(); }}
            listening={true}>
            <Circle radius={btnR} fill="#f44336" stroke="white" strokeWidth={1.5} />
            <Line points={[-4, -4, 4, 4]} stroke="white" strokeWidth={2} lineCap="round" listening={false} />
            <Line points={[4, -4, -4, 4]} stroke="white" strokeWidth={2} lineCap="round" listening={false} />
          </Group>
        );
      })()}
    </>
  );
}
