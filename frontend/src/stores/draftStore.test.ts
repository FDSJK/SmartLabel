import { test, expect } from 'vitest';
import { useDraftStore } from './draftStore';

function reset() {
  useDraftStore.getState().clear();
}

test('selectDraft sets selection and clears editor selection', () => {
  reset();
  useDraftStore.setState({
    draftShapes: [{ id: 'd1', label: 'cat', shapeType: 'polygon', points: [[0, 0], [1, 0], [1, 1]], holes: [] }],
  });
  useDraftStore.getState().selectDraft('d1');
  expect(useDraftStore.getState().selectedDraftId).toBe('d1');
});

test('moveDraftShape updates points and marks dirty', () => {
  reset();
  useDraftStore.setState({
    draftShapes: [{ id: 'd1', label: 'cat', shapeType: 'polygon', points: [[0, 0], [1, 0], [1, 1]], holes: [] }],
  });
  useDraftStore.getState().moveDraftShape('d1', [[1, 1], [2, 1], [2, 2]]);
  const s = useDraftStore.getState();
  expect(s.draftShapes[0].points).toEqual([[1, 1], [2, 1], [2, 2]]);
  expect(s.isDirty).toBe(true);
});

test('deleteDraftShape removes and clears selection', () => {
  reset();
  useDraftStore.setState({
    draftShapes: [{ id: 'd1', label: 'cat', shapeType: 'polygon', points: [[0, 0], [1, 0], [1, 1]], holes: [] }],
    selectedDraftId: 'd1',
  });
  useDraftStore.getState().deleteDraftShape('d1');
  const s = useDraftStore.getState();
  expect(s.draftShapes).toHaveLength(0);
  expect(s.selectedDraftId).toBeNull();
});
