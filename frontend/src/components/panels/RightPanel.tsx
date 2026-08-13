import { useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useLabelStore } from '../../stores/labelStore';
import LabelStatusList from './LabelStatusList';
import type { EditorTool } from '../../types/shapes';
import styles from './RightPanel.module.css';

interface ToolButton {
  tool: EditorTool;
  label: string;
  shortcut: string;
}

const TOOLS: ToolButton[] = [
  { tool: 'polygon', label: '多边形', shortcut: 'P' },
  { tool: 'freehand', label: '自由绘制', shortcut: 'F' },
  { tool: 'select', label: '选择', shortcut: 'S' },
  { tool: 'add', label: '+ 增添', shortcut: 'A' },
  { tool: 'cut', label: '- 裁剪', shortcut: 'X' },
];

type PanelTab = 'status' | 'shapes';

export default function RightPanel() {
  const [tab, setTab] = useState<PanelTab>('shapes');
  const currentTool = useEditorStore(s => s.currentTool);
  const setTool = useEditorStore(s => s.setTool);
  const shapes = useEditorStore(s => s.shapes);
  const selectedShapeId = useEditorStore(s => s.selectedShapeId);
  const selectShape = useEditorStore(s => s.selectShape);
  const selectedLabel = useEditorStore(s => s.selectedLabel);
  const labels = useLabelStore(s => s.labels);

  // Label color lookup
  const colorMap = new Map<string, string>();
  for (const l of labels) {
    colorMap.set(l.name, l.color);
  }

  // Shape list bound to the currently-selected label
  const visibleShapes = selectedLabel
    ? shapes.filter(s => s.label === selectedLabel)
    : shapes;

  function handleShapeClick(shapeId: string) {
    // Switch to edit mode and select the shape
    if (currentTool !== 'select') setTool('select');
    selectShape(selectedShapeId === shapeId ? null : shapeId);
  }

  function handleDelete(shapeId: string, e: React.MouseEvent) {
    e.stopPropagation();
    // Select then delete
    if (selectedShapeId !== shapeId) {
      selectShape(shapeId);
    }
    // Use setTimeout to allow the select to take effect first
    setTimeout(() => {
      useEditorStore.getState().deleteSelectedShape();
    }, 0);
  }

  return (
    <div className={styles.panel}>
      {/* Tool selector */}
      <div className={styles.section}>
        <h3 className={styles.title}>工具</h3>
        <div className={styles.toolGroup}>
          {TOOLS.map(t => (
            <button
              key={t.tool}
              className={`${styles.toolBtn} ${currentTool === t.tool ? styles.toolBtnActive : ''}`}
              onClick={() => setTool(t.tool)}
              title={`${t.label} (${t.shortcut})`}
            >
              <span className={styles.toolShortcut}>{t.shortcut}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        {currentTool === 'select' && (
          <p className={styles.hint}>
            双击选择形状，拖动顶点或形状移动。点 × 或按 Delete 删除。
          </p>
        )}
        {currentTool === 'add' && (
          <p className={styles.hint}>
            先选择目标形状，再自由绘制增加区域，松开鼠标应用。
          </p>
        )}
        {currentTool === 'cut' && (
          <p className={styles.hint}>
            先选择目标形状，再自由绘制裁剪区域，松开鼠标应用。
          </p>
        )}
      </div>

      {/* Tabs: label status / shape list */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'status' ? styles.tabActive : ''}`}
          onClick={() => setTab('status')}
        >
          标签状态
        </button>
        <button
          className={`${styles.tab} ${tab === 'shapes' ? styles.tabActive : ''}`}
          onClick={() => setTab('shapes')}
        >
          标注 ({visibleShapes.length})
        </button>
      </div>

      {/* Tab content */}
      <div className={styles.sectionGrow}>
        {tab === 'status' ? (
          <LabelStatusList />
        ) : visibleShapes.length === 0 ? (
          <p className={styles.hint}>
            {selectedLabel
              ? `「${selectedLabel}」暂无标注`
              : '暂无标注，选择一个标签开始绘制'}
          </p>
        ) : (
          <div className={styles.shapeList}>
            {visibleShapes.map((shape, i) => {
              const isSelected = selectedShapeId === shape.id;
              const color = colorMap.get(shape.label) || '#888';
              return (
                <div
                  key={shape.id}
                  className={`${styles.shapeItem} ${isSelected ? styles.shapeItemSelected : ''}`}
                  onClick={() => handleShapeClick(shape.id)}
                  title={isSelected ? '点击取消选中' : '点击选中'}
                >
                  <span
                    className={styles.shapeColor}
                    style={{ backgroundColor: color }}
                  />
                  <span className={styles.shapeIndex}>#{i + 1}</span>
                  <span className={styles.shapeLabel}>{shape.label}</span>
                  <button
                    className={styles.shapeDelete}
                    onClick={(e) => handleDelete(shape.id, e)}
                    title="删除此标注"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
