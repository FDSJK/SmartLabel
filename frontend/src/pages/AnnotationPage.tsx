import BatchSelector from '../components/panels/BatchSelector';
import ImageList from '../components/panels/ImageList';

export default function AnnotationPage() {
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)' }}>
      {/* Left panel */}
      <div style={{ width: 260, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
        <BatchSelector />
        <ImageList />
      </div>
      {/* Center — canvas placeholder */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
        选择一张图像开始标注
      </div>
      {/* Right panel placeholder */}
      <div style={{ width: 260, background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', padding: 12 }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>标签与状态面板 — Phase 2</p>
      </div>
    </div>
  );
}
