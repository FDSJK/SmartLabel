import { useLabelStore } from '../../stores/labelStore';
import { useEditorStore } from '../../stores/editorStore';
import type { LabelStatusValue } from '../../types/shapes';
import styles from './LabelStatusList.module.css';

const STATUS_OPTIONS: { value: LabelStatusValue; label: string; className: string }[] = [
  { value: 'present', label: '✓ 存在', className: 'present' },
  { value: 'absent', label: '✗ 不存在', className: 'absent' },
  { value: 'pending', label: '○ 待定', className: 'pending' },
];

export default function LabelStatusList() {
  const labels = useLabelStore(s => s.labels);
  const selectedLabel = useEditorStore(s => s.selectedLabel);
  const labelStatus = useEditorStore(s => s.labelStatus);
  const setSelectedLabel = useEditorStore(s => s.setSelectedLabel);
  const cycleLabelStatus = useEditorStore(s => s.cycleLabelStatus);

  const enabledLabels = labels.filter(l => l.enabled);

  if (enabledLabels.length === 0) {
    return <div className={styles.empty}>暂无标签，请先创建</div>;
  }

  return (
    <div className={styles.section}>
      <div className={styles.list}>
        {enabledLabels.map(label => {
          const status = labelStatus[label.name] || 'pending';
          const isSelected = selectedLabel === label.name;

          return (
            <div
              key={label.id}
              className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
            >
              {/* Color swatch — click to select as active label */}
              <button
                className={styles.swatch}
                style={{ backgroundColor: label.color }}
                onClick={() =>
                  setSelectedLabel(isSelected ? null : label.name)
                }
                title={isSelected ? '取消选中' : '选中标签进行标注'}
              />

              {/* Label name */}
              <span
                className={styles.name}
                onClick={() =>
                  setSelectedLabel(isSelected ? null : label.name)
                }
              >
                {label.name}
              </span>

              {/* Status toggle */}
              <button
                className={`${styles.statusBtn} ${styles[STATUS_OPTIONS.find(o => o.value === status)?.className || 'pending']}`}
                onClick={() => cycleLabelStatus(label.name)}
                title={`状态: ${status}（点击切换待定）`}
              >
                {STATUS_OPTIONS.find(o => o.value === status)?.label || '?'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
