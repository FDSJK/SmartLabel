import { useEffect, useRef, useState } from 'react';
import { listModels, createModel, updateModel, deleteModel, uploadModel } from '../api/models';
import { useLabelStore } from '../stores/labelStore';
import type { ModelConfig, ModelConfigInput, CategoryMapping } from '../types/model';
import { ApiError } from '../api/client';
import styles from './AdminModelsPage.module.css';

const EMPTY: ModelConfigInput = {
  name: '', source: 'upload', model_path: '', input_width: 512, input_height: 512,
  resize_mode: 'stretch', normalize_mode: 'min_max', mean: null, std: null,
  background_channel: 0, categories: [], postprocess: 'argmax', sigmoid_threshold: 0.5, enabled: true,
};

function parseFloatList(s: string): number[] | null {
  const parts = s.split(',').map((x) => x.trim()).filter((x) => x !== '');
  if (parts.length === 0) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  return nums;
}

export default function AdminModelsPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [form, setForm] = useState<ModelConfigInput>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const labels = useLabelStore((s) => s.labels);
  const loadLabels = useLabelStore((s) => s.load);

  const load = async () => {
    try { setModels(await listModels()); } catch { setError('加载失败'); }
  };
  useEffect(() => { load(); loadLabels(); }, [loadLabels]);

  const set = <K extends keyof ModelConfigInput>(k: K, v: ModelConfigInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit() {
    setError('');
    let path = form.model_path;
    try {
      if (form.source === 'upload' && fileRef.current?.files?.[0]) {
        const r = await uploadModel(fileRef.current.files[0]);
        path = r.filename;
      }
      if (!path) { setError('请填写模型路径或选择文件'); return; }
      const body = { ...form, model_path: path };
      if (editingId) await updateModel(editingId, body);
      else await createModel(body);
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '保存失败');
    }
  }

  function resetForm() {
    setForm(EMPTY); setEditingId(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function edit(m: ModelConfig) {
    setEditingId(m.id);
    if (fileRef.current) fileRef.current.value = '';
    setForm({
      name: m.name, source: m.source, model_path: m.model_path,
      input_width: m.input_width, input_height: m.input_height,
      resize_mode: m.resize_mode, normalize_mode: m.normalize_mode,
      mean: m.mean, std: m.std, background_channel: m.background_channel,
      categories: m.categories, postprocess: m.postprocess,
      sigmoid_threshold: m.sigmoid_threshold, enabled: m.enabled,
    });
  }

  async function remove(m: ModelConfig) {
    if (!confirm(`确定删除模型「${m.name}」？`)) return;
    try { await deleteModel(m.id); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.detail : '删除失败'); }
  }

  const updateCat = (i: number, patch: Partial<CategoryMapping>) =>
    setForm((f) => ({ ...f, categories: f.categories.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  const addCat = () =>
    setForm((f) => ({ ...f, categories: [...f.categories, { label: '', channel: f.categories.length }] }));
  const removeCat = (i: number) =>
    setForm((f) => ({ ...f, categories: f.categories.filter((_, idx) => idx !== i) }));

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>模型配置</h2>
      {error && (
        <div className={styles.error}>
          <span>{error}</span>
          <button className={styles.errorClose} onClick={() => setError('')} title="关闭">×</button>
        </div>
      )}

      <h3 className={styles.sectionTitle}>模型列表</h3>
      <table className={styles.table}>
        <thead>
          <tr><th>名称</th><th>来源</th><th>输入尺寸</th><th>后处理</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{m.source === 'upload' ? '上传' : '路径'}</td>
              <td>{m.input_width}×{m.input_height}</td>
              <td>{m.postprocess}</td>
              <td>{m.enabled ? '启用' : '停用'}</td>
              <td className={styles.actions}>
                <button className={styles.btnSmall} onClick={() => edit(m)}>编辑</button>
                <button className={`${styles.btnSmall} ${styles.btnDanger}`} onClick={() => remove(m)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className={styles.sectionTitle}>{editingId ? '编辑模型' : '新建模型'}</h3>
      <div className={styles.form}>
        <div className={styles.field}>
          <label>名称</label>
          <input className={styles.input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="模型名称" />
        </div>

        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label>来源</label>
            <select className={styles.select} value={form.source} onChange={(e) => set('source', e.target.value as ModelConfigInput['source'])}>
              <option value="upload">网页上传</option>
              <option value="path">服务器路径</option>
            </select>
          </div>
          {form.source === 'upload' ? (
            <div className={styles.field}>
              <label>模型文件（.onnx）</label>
              <input ref={fileRef} className={styles.input} type="file" accept=".onnx"
                onChange={() => { /* file 在提交时读取 */ }} />
              {editingId && <span className={styles.hint}>已存：{form.model_path}</span>}
            </div>
          ) : (
            <div className={styles.field}>
              <label>服务器路径</label>
              <input className={styles.input} value={form.model_path} onChange={(e) => set('model_path', e.target.value)} placeholder="/path/to/model.onnx" />
            </div>
          )}
        </div>

        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label>输入宽</label>
            <input className={styles.input} type="number" value={form.input_width} onChange={(e) => set('input_width', Number(e.target.value))} />
          </div>
          <div className={styles.field}>
            <label>输入高</label>
            <input className={styles.input} type="number" value={form.input_height} onChange={(e) => set('input_height', Number(e.target.value))} />
          </div>
        </div>

        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label>resize 方式</label>
            <select className={styles.select} value={form.resize_mode} onChange={(e) => set('resize_mode', e.target.value as ModelConfigInput['resize_mode'])}>
              <option value="stretch">stretch（直接拉伸）</option>
            </select>
          </div>
          <div className={styles.field}>
            <label>归一化</label>
            <select className={styles.select} value={form.normalize_mode} onChange={(e) => set('normalize_mode', e.target.value as ModelConfigInput['normalize_mode'])}>
              <option value="min_max">min_max</option>
              <option value="mean_std">mean_std</option>
              <option value="none">none</option>
            </select>
          </div>
        </div>

        {form.normalize_mode === 'mean_std' && (
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label>mean（逗号分隔 3 个数）</label>
              <input className={styles.input} value={(form.mean ?? []).join(',')} onChange={(e) => set('mean', parseFloatList(e.target.value))} placeholder="0.485,0.456,0.406" />
            </div>
            <div className={styles.field}>
              <label>std（逗号分隔 3 个数）</label>
              <input className={styles.input} value={(form.std ?? []).join(',')} onChange={(e) => set('std', parseFloatList(e.target.value))} placeholder="0.229,0.224,0.225" />
            </div>
          </div>
        )}

        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label>背景通道索引</label>
            <input className={styles.input} type="number" value={form.background_channel} onChange={(e) => set('background_channel', Number(e.target.value))} />
          </div>
          <div className={styles.field}>
            <label>后处理</label>
            <select className={styles.select} value={form.postprocess} onChange={(e) => set('postprocess', e.target.value as ModelConfigInput['postprocess'])}>
              <option value="argmax">argmax</option>
              <option value="sigmoid">sigmoid</option>
            </select>
          </div>
        </div>

        {form.postprocess === 'sigmoid' && (
          <div className={styles.field}>
            <label>sigmoid 阈值</label>
            <input className={styles.input} type="number" step="0.1" value={form.sigmoid_threshold} onChange={(e) => set('sigmoid_threshold', Number(e.target.value))} />
          </div>
        )}

        <div className={styles.field}>
          <label>类别映射（标签 → 输出通道）</label>
          {form.categories.map((c, i) => (
            <div className={styles.catRow} key={i}>
              <select className={styles.select} value={c.label} onChange={(e) => updateCat(i, { label: e.target.value })}>
                <option value="">选择标签</option>
                {labels.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
              </select>
              <input className={`${styles.input} ${styles.channel}`} type="number" placeholder="通道" value={c.channel} onChange={(e) => updateCat(i, { channel: Number(e.target.value) })} />
              <button className={`${styles.btnSmall} ${styles.btnDanger} ${styles.removeBtn}`} onClick={() => removeCat(i)}>×</button>
            </div>
          ))}
          <button className={styles.btnSmall} onClick={addCat} type="button">+ 添加类别</button>
        </div>

        <label className={styles.checkbox}>
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> 启用
        </label>

        <div className={styles.formActions}>
          <button className={styles.btn} onClick={onSubmit}>{editingId ? '保存' : '创建'}</button>
          {editingId && <button className={styles.btnSmall} onClick={resetForm}>取消</button>}
        </div>
      </div>
    </div>
  );
}
