// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest';
import { useEditorStore } from './editorStore';

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
