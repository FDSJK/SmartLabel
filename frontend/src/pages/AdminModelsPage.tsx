import { useEffect, useRef, useState } from 'react';
import { listModels, createModel, updateModel, deleteModel, uploadModel } from '../api/models';
import { useLabelStore } from '../stores/labelStore';
import type { ModelConfig, ModelConfigInput, CategoryMapping } from '../types/model';

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
  const [message, setMessage] = useState('');
  const fileRef = useRef<File | null>(null);
  const labels = useLabelStore((s) => s.labels);
  const loadLabels = useLabelStore((s) => s.load);

  const refresh = () => listModels().then(setModels).catch(() => {});
  useEffect(() => { refresh(); loadLabels(); }, [loadLabels]);

  const set = <K extends keyof ModelConfigInput>(k: K, v: ModelConfigInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit() {
    setMessage('');
    let path = form.model_path;
    if (form.source === 'upload' && fileRef.current) {
      const r = await uploadModel(fileRef.current);
      path = r.filename;
    }
    if (!path) { setMessage('请填写模型路径或选择文件'); return; }
    const body = { ...form, model_path: path };
    try {
      if (editingId) await updateModel(editingId, body);
      else await createModel(body);
      setForm(EMPTY); setEditingId(null); fileRef.current = null;
      refresh();
    } catch (e) {
      setMessage(`保存失败：${(e as Error).message}`);
    }
  }

  function edit(m: ModelConfig) {
    setEditingId(m.id);
    fileRef.current = null;
    setForm({
      name: m.name, source: m.source, model_path: m.model_path,
      input_width: m.input_width, input_height: m.input_height,
      resize_mode: m.resize_mode, normalize_mode: m.normalize_mode,
      mean: m.mean, std: m.std, background_channel: m.background_channel,
      categories: m.categories, postprocess: m.postprocess,
      sigmoid_threshold: m.sigmoid_threshold, enabled: m.enabled,
    });
  }

  async function remove(id: number) {
    await deleteModel(id);
    refresh();
  }

  const updateCat = (i: number, patch: Partial<CategoryMapping>) =>
    setForm((f) => ({ ...f, categories: f.categories.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  const addCat = () =>
    setForm((f) => ({ ...f, categories: [...f.categories, { label: '', channel: f.categories.length }] }));
  const removeCat = (i: number) =>
    setForm((f) => ({ ...f, categories: f.categories.filter((_, idx) => idx !== i) }));

  return (
    <div>
      <h2>模型配置</h2>
      <ul>
        {models.map((m) => (
          <li key={m.id}>
            <strong>{m.name}</strong>（{m.source} / {m.input_width}×{m.input_height} / {m.postprocess} / {m.enabled ? '启用' : '停用'}）
            <button onClick={() => edit(m)}>编辑</button>
            <button onClick={() => remove(m.id)}>删除</button>
          </li>
        ))}
      </ul>

      <h3>{editingId ? '编辑模型' : '新建模型'}</h3>
      <div>
        <label>名称 <input value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label>来源
          <select value={form.source} onChange={(e) => set('source', e.target.value as ModelConfigInput['source'])}>
            <option value="upload">网页上传</option>
            <option value="path">服务器路径</option>
          </select>
        </label>
        {form.source === 'upload' ? (
          <label>模型文件 <input type="file" accept=".onnx" onChange={(e) => { fileRef.current = e.target.files?.[0] ?? null; }} /></label>
        ) : (
          <label>路径 <input value={form.model_path} onChange={(e) => set('model_path', e.target.value)} /></label>
        )}
        <label>输入宽 <input type="number" value={form.input_width} onChange={(e) => set('input_width', Number(e.target.value))} /></label>
        <label>输入高 <input type="number" value={form.input_height} onChange={(e) => set('input_height', Number(e.target.value))} /></label>
        <label>resize
          <select value={form.resize_mode} onChange={(e) => set('resize_mode', e.target.value as ModelConfigInput['resize_mode'])}>
            <option value="stretch">stretch</option>
            <option value="letterbox">letterbox</option>
          </select>
        </label>
        <label>归一化
          <select value={form.normalize_mode} onChange={(e) => set('normalize_mode', e.target.value as ModelConfigInput['normalize_mode'])}>
            <option value="min_max">min_max</option>
            <option value="mean_std">mean_std</option>
            <option value="none">none</option>
          </select>
        </label>
        {form.normalize_mode === 'mean_std' && (
          <>
            <label>mean <input value={(form.mean ?? []).join(',')} onChange={(e) => set('mean', parseFloatList(e.target.value))} /></label>
            <label>std <input value={(form.std ?? []).join(',')} onChange={(e) => set('std', parseFloatList(e.target.value))} /></label>
          </>
        )}
        <label>背景通道 <input type="number" value={form.background_channel} onChange={(e) => set('background_channel', Number(e.target.value))} /></label>
        <label>后处理
          <select value={form.postprocess} onChange={(e) => set('postprocess', e.target.value as ModelConfigInput['postprocess'])}>
            <option value="argmax">argmax</option>
            <option value="sigmoid">sigmoid</option>
          </select>
        </label>
        {form.postprocess === 'sigmoid' && (
          <label>sigmoid 阈值 <input type="number" step="0.1" value={form.sigmoid_threshold} onChange={(e) => set('sigmoid_threshold', Number(e.target.value))} /></label>
        )}
        <label><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> 启用</label>

        <h4>类别映射（标签 → 通道）</h4>
        {form.categories.map((c, i) => (
          <div key={i}>
            <select value={c.label} onChange={(e) => updateCat(i, { label: e.target.value })}>
              <option value="">选择标签</option>
              {labels.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
            <input type="number" value={c.channel} onChange={(e) => updateCat(i, { channel: Number(e.target.value) })} />
            <button onClick={() => removeCat(i)}>×</button>
          </div>
        ))}
        <button onClick={addCat}>+ 添加类别</button>

        <button onClick={onSubmit}>{editingId ? '保存' : '创建'}</button>
        {editingId && <button onClick={() => { setEditingId(null); setForm(EMPTY); fileRef.current = null; }}>取消</button>}
        {message && <p>{message}</p>}
      </div>
    </div>
  );
}
