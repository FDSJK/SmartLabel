import { useRef, useCallback, useState } from 'react';
import { Circle, Line, Rect, Group, Label, Tag, Text } from 'react-konva';
import { useEditorStore } from '../../stores/editorStore';
import { useDraftStore } from '../../stores/draftStore';
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

/** 是否为 macOS：Mac 上 Ctrl+点击是右键，平移快捷键应为 Cmd(metaKey)。 */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

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
  const showMask = useUIStore(s => s.showMask);
  const hiddenLabels = useUIStore(s => s.hiddenLabels);
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
    isDraft?: boolean;
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
  const drawingActive = selectedLabel !== null && isDrawing && currentImage !== null && showMask;
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

      // Mac 上 Ctrl+点击是右键（contextmenu），用于闭合/取消多边形与自由绘制。
      // 它用的是左键（button === 0），不能当作平移，也不能落入下面的绘制分支，
      // 否则会误增一个顶点 / 重新起笔。这里直接返回，交给 onContextMenu 处理。
      if (IS_MAC && e.evt.ctrlKey && e.evt.button === 0) {
        return;
      }

      // 平移：Mac 用 Cmd(metaKey)，其他平台用 Ctrl；中键(button 1)通用。
      const panKey = (IS_MAC ? e.evt.metaKey : e.evt.ctrlKey) || e.evt.button === 1;
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
          console.log('[polygon mousedown]', { button: e.evt.button, points: useEditorStore.getState().drawingPoints?.length ?? 0 });
          e.evt.preventDefault();
          return;
        }
        if (currentTool === 'freehand' && e.evt.button === 0) {
          const store = useEditorStore.getState();
          // 已有未闭合曲线（松手后等待双击闭合）时不再新增点，
          // 否则双击闭合的两次 mousedown 会误加孤立点。
          if (store.drawingPoints !== null) {
            return;
          }
          store.startDrawing();
          store.addDrawingPoint(ix, iy);
          freehandActive.current = true;
          lastFreehandPoint.current = [ix, iy];
          console.log('[freehand mousedown]', { points: useEditorStore.getState().drawingPoints?.length ?? 0 });
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

          // Draft selection takes priority (draft renders on top)
          const selectedDraftId = useDraftStore.getState().selectedDraftId;
          if (selectedDraftId) {
            const drafts = useDraftStore.getState().draftShapes;
            const selDraft = drafts.find(s => s.id === selectedDraftId);
            if (selDraft) {
              const v = findNearestVertex(sx, sy, [selDraft], VERTEX_HIT_RADIUS);
              if (v) {
                hit = true;
                dragRef.current = {
                  type: 'vertex', shapeId: v.shapeId, vertexIndex: v.vertexIndex,
                  startPoints: selDraft.points.map(p => [...p]), startPos: [ix, iy], isDraft: true,
                };
              } else if (isPointInShape(sx, sy, selDraft.points, selDraft.holes ?? [])) {
                hit = true;
                dragRef.current = {
                  type: 'shape', shapeId: selDraft.id,
                  startPoints: selDraft.points.map(p => [...p]),
                  startHoles: (selDraft.holes ?? []).map(h => h.map(p => [...p])),
                  startPos: [ix, iy], isDraft: true,
                };
              }
            }
          }
          if (hit) return;

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
          if (d.isDraft) useDraftStore.getState().moveDraftVertex(d.shapeId, d.vertexIndex, np[d.vertexIndex][0], np[d.vertexIndex][1]);
          else useEditorStore.getState().updateShape(d.shapeId, np);
        } else if (d.type === 'shape') {
          const np = d.startPoints.map(p => [p[0] + dx, p[1] + dy]);
          const nh = (d.startHoles ?? []).map(h => h.map(p => [p[0] + dx, p[1] + dy]));
          if (d.isDraft) useDraftStore.getState().moveDraftShape(d.shapeId, np, nh);
          else useEditorStore.getState().updateShape(d.shapeId, np, nh);
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
      // Double-click selection works in select / add / cut modes.
      // 自由绘制的「双击闭合」改由容器级原生 dblclick 处理（见 KonvaStage），
      // 不再走 Konva 合成的 dblclick——它按 mousedown/mouseup 计数，绘制松手时
      // 已把双击窗口占用，导致下一次单击被误判为双击、行为不稳定。
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

      // 0) Hit draft first (draft renders on top)
      const draftShapes = useDraftStore.getState().draftShapes;
      const dv = findNearestVertex(ix, iy, draftShapes, DBLCLICK_HIT_RADIUS);
      if (dv) { useDraftStore.getState().selectDraft(dv.shapeId); return; }
      const dEdge = findNearestShape(ix, iy, draftShapes, DBLCLICK_HIT_RADIUS);
      if (dEdge) { useDraftStore.getState().selectDraft(dEdge); return; }
      for (const dShape of draftShapes) {
        if (isPointInShape(ix, iy, dShape.points, dShape.holes ?? [])) {
          useDraftStore.getState().selectDraft(dShape.id);
          return;
        }
      }

      const store = useEditorStore.getState();
      // 被隐藏（眼睛关闭）的标签不参与双击选中：其 mask 不可见，不应被选中。
      // 否则重叠区域内双击会选到看不见的形状。
      const hiddenLabels = useUIStore.getState().hiddenLabels;
      const currentShapes = store.shapes.filter(s => !hiddenLabels[s.label]);

      // 1) 命中形状内部（含多个重叠 shape，不同标签互相压盖）：按视觉层叠顺序
      //    （后渲染的在上层）循环选中，从而能选到被遮住的隐藏标签。
      //    必须放在顶点/边检测之前——否则重叠区域内的点击总被最近顶点/边抢走，
      //    每次选中同一个 shape，永远切不到下面的标签。
      const hits = currentShapes
        .filter(shape => isPointInShape(ix, iy, shape.points, shape.holes ?? []))
        .reverse(); // reverse → 最上层在前
      if (hits.length > 0) {
        const currentId = store.selectedShapeId;
        const idx = hits.findIndex(s => s.id === currentId);
        const next = idx >= 0 ? hits[(idx + 1) % hits.length] : hits[0];
        store.selectShape(next.id);
        useDraftStore.getState().selectDraft(null);
        return;
      }

      // 2) 点不在任何形状内但靠近顶点：选中该形状（兜底）
      const v = findNearestVertex(ix, iy, currentShapes, DBLCLICK_HIT_RADIUS);
      if (v) {
        store.selectShape(v.shapeId);
        useDraftStore.getState().selectDraft(null);
        return;
      }
      // 3) 靠近边：选中该形状（兜底）
      const edgeId = findNearestShape(ix, iy, currentShapes, DBLCLICK_HIT_RADIUS);
      if (edgeId) {
        store.selectShape(edgeId);
        useDraftStore.getState().selectDraft(null);
        return;
      }
      // Double-click on empty → deselect
      store.selectShape(null);
      useDraftStore.getState().selectDraft(null);
    },
    [isSelecting, isAdding, isCutting],
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

  const foundShape = selectedShapeId
    ? (shapes.find(s => s.id === selectedShapeId) ?? null)
    : null;
  // 标签被隐藏（眼睛关闭）后，其选中态（外框 / 名字徽章 / 顶点手柄 / 删除按钮）一并隐藏
  const selectedShape = foundShape && !hiddenLabels[foundShape.label] ? foundShape : null;

  // Highlight the selected shape in its own label color, not a fixed cyan
  const selectedShapeColor = selectedShape
    ? (labels.find(l => l.name === selectedShape.label)?.color || '#00e5ff')
    : '#00e5ff';

  const selectedDraftId = useDraftStore(s => s.selectedDraftId);
  const draftShapes = useDraftStore(s => s.draftShapes);
  const selectedDraft = selectedDraftId
    ? (draftShapes.find(s => s.id === selectedDraftId) ?? null)
    : null;

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

      {/* Selected shape label name badge — 循环选中重叠标签时展示名字 */}
      {selectedShape && (isSelecting || isAdding || isCutting) && (() => {
        const pts = selectedShape.points;
        let minX = Infinity, minY = Infinity;
        for (const [x, y] of pts) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
        }
        return (
          <Label x={minX} y={minY - 32} listening={false}>
            <Tag
              fill={selectedShapeColor}
              cornerRadius={4}
              opacity={0.92}
              shadowColor="rgba(0,0,0,0.5)"
              shadowBlur={4}
              shadowOffsetY={1}
            />
            <Text
              text={selectedShape.label}
              fill="#fff"
              fontSize={13}
              fontStyle="bold"
              padding={6}
              listening={false}
            />
          </Label>
        );
      })()}

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

      {/* Selected draft outline — select mode */}
      {isSelecting && selectedDraft && (
        <Line
          points={selectedDraft.points.flat()}
          closed
          stroke="#2196f3"
          strokeWidth={4}
          dash={[6, 3]}
          lineJoin="round"
          shadowColor="#2196f3"
          shadowBlur={10}
          listening={false}
        />
      )}

      {/* Select: draft vertex handles */}
      {isSelecting && selectedDraft &&
        selectedDraft.points.map(([x, y], i) => (
          <Circle key={`dv-${i}`} x={x} y={y}
            radius={VERTEX_RADIUS}
            fill="white" stroke="#2196f3"
            strokeWidth={2}
            listening={false} />
        ))}

      {/* Select: draft delete button */}
      {isSelecting && selectedDraft && (() => {
        const pts = selectedDraft.points;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of pts) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        const btnR = 10;
        return (
          <Group x={(minX + maxX) / 2} y={minY - btnR - 6}
            onClick={() => { useDraftStore.getState().deleteDraftShape(selectedDraft.id); }}
            onTap={() => { useDraftStore.getState().deleteDraftShape(selectedDraft.id); }}
            listening={true}>
            <Circle radius={btnR} fill="#2196f3" stroke="white" strokeWidth={1.5} />
            <Line points={[-4, -4, 4, 4]} stroke="white" strokeWidth={2} lineCap="round" listening={false} />
            <Line points={[4, -4, -4, 4]} stroke="white" strokeWidth={2} lineCap="round" listening={false} />
          </Group>
        );
      })()}
    </>
  );
}
