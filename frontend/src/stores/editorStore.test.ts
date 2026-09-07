// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest';
import { useEditorStore } from './editorStore';
import type { Shape } from '../types/shapes';

function square(id: string, x: number, y: number, size = 10): Shape {
  return {
    id,
    label: 'cat',
    shapeType: 'polygon',
    points: [[x, y], [x + size, y], [x + size, y + size], [x, y + size]],
    holes: [],
  };
}

function drawCat(): string {
  const s = useEditorStore.getState();
  s.setSelectedLabel('cat');
  s.startDrawing();
  s.addDrawingPoint(0, 0);
  s.addDrawingPoint(10, 0);
  s.addDrawingPoint(10, 10);
  s.finishDrawing();
  return useEditorStore.getState().shapes[0].id;
}

describe('label status follows content', () => {
  beforeEach(() => useEditorStore.getState().reset());

  it('drawing a shape marks the label present', () => {
    drawCat();
    expect(useEditorStore.getState().labelStatus['cat']).toBe('present');
  });

  it('deleting the last shape marks the label absent', () => {
    const id = drawCat();
    useEditorStore.getState().selectShape(id);
    useEditorStore.getState().deleteSelectedShape();
    expect(useEditorStore.getState().labelStatus['cat']).toBe('absent');
  });

  it('cycleLabelStatus toggles pending and resolves by content', () => {
    useEditorStore.getState().cycleLabelStatus('cat');  // pending(no shapes) -> absent
    expect(useEditorStore.getState().labelStatus['cat']).toBe('absent');
    useEditorStore.getState().cycleLabelStatus('cat');  // absent -> pending
    expect(useEditorStore.getState().labelStatus['cat']).toBe('pending');
    drawCat();                                       // -> present (auto)
    expect(useEditorStore.getState().labelStatus['cat']).toBe('present');
    useEditorStore.getState().cycleLabelStatus('cat'); // present -> pending
    expect(useEditorStore.getState().labelStatus['cat']).toBe('pending');
    useEditorStore.getState().cycleLabelStatus('cat'); // pending -> present (has shapes)
    expect(useEditorStore.getState().labelStatus['cat']).toBe('present');
  });
});

describe('applyAdd merges only overlapping shapes', () => {
  beforeEach(() => useEditorStore.getState().reset());

  it('leaves far-away same-label shapes untouched', () => {
    useEditorStore.getState().loadAnnotation(
      [square('sel', 0, 0), square('far', 1000, 1000)],
      { cat: 'present' },
      0,
    );
    useEditorStore.getState().selectShape('sel');

    // 绘制区域只覆盖 sel，远距离的 far 不应被合并/重编号
    useEditorStore.getState().applyAdd([[0, 0], [20, 0], [20, 20], [0, 20]]);

    const after = useEditorStore.getState().shapes;
    const far = after.find(s => s.id === 'far');
    expect(far).toBeDefined();
    expect(far!.points).toEqual([[1000, 1000], [1010, 1000], [1010, 1010], [1000, 1010]]);
  });

  it('merges overlapping same-label shapes into one', () => {
    useEditorStore.getState().loadAnnotation(
      [square('sel', 0, 0), square('near', 8, 8)],
      { cat: 'present' },
      0,
    );
    useEditorStore.getState().selectShape('sel');

    // 绘制区域桥接 sel 与 near
    useEditorStore.getState().applyAdd([[0, 0], [20, 0], [20, 20], [0, 20]]);

    const after = useEditorStore.getState().shapes;
    expect(after.length).toBe(1);
    expect(after[0].id).toBe('sel');
  });
});
