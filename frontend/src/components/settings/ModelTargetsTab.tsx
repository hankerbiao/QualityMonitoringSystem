import { useRef, useState, type ChangeEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Plus, Search, Trash2, Upload } from 'lucide-react';
import { settingsApi } from '../../api/settingsApi';
import { buildModelTargetsTemplate, parseModelTargetsTemplate } from './modelTargetsTemplate';

interface ModelTargetsTabProps {
  targets: Record<string, number>;
  onChange: (targets: Record<string, number>) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

const PAGE_SIZE = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('文件读取失败，请重试'));
    reader.readAsArrayBuffer(file);
  });
}

export function ModelTargetsTab({ targets, onChange, disabled = false, onBusyChange }: ModelTargetsTabProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const latestTargets = useRef(targets);
  latestTargets.current = targets;
  const [busy, setBusy] = useState<'download' | 'import' | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [newModel, setNewModel] = useState('');
  const [newTarget, setNewTarget] = useState('100');
  const locked = disabled || busy !== null;
  const entries = Object.entries(targets).filter(([model]) => model.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const begin = (operation: 'download' | 'import') => {
    if (disabled || busyRef.current) return false;
    busyRef.current = true;
    setBusy(operation);
    onBusyChange?.(true);
    setError('');
    setMessage('');
    return true;
  };
  const finish = () => {
    busyRef.current = false;
    setBusy(null);
    onBusyChange?.(false);
  };

  const downloadTemplate = async () => {
    if (!begin('download')) return;
    try {
      const [models, XLSX] = await Promise.all([
        settingsApi.getModelTargetSourceModels(), import('xlsx'),
      ]);
      const workbook = buildModelTargetsTemplate(models, latestTargets.current);
      XLSX.writeFile(workbook, '直通率标准配置模板.xlsx');
      setMessage(`模板已下载，共 ${XLSX.utils.decode_range(workbook.Sheets['直通率标准']['!ref']!).e.r} 个机型`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '模板下载失败，请重试');
    } finally {
      finish();
    }
  };

  const importTemplate = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !begin('import')) return;
    try {
      if (!/\.xlsx?$/i.test(file.name)) throw new Error('请选择 .xlsx 或 .xls 格式的 Excel 文件');
      if (file.size > MAX_FILE_BYTES) throw new Error('文件大小不能超过 10 MB');
      const [data, XLSX] = await Promise.all([readFile(file), import('xlsx')]);
      const imported = parseModelTargetsTemplate(XLSX.read(data, { type: 'array', cellNF: true }));
      onChange({ ...latestTargets.current, ...imported });
      setSearch('');
      setPage(0);
      setMessage(`已导入 ${Object.keys(imported).length} 个机型，待保存`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '模板导入失败，请检查文件');
    } finally {
      finish();
    }
  };

  const changeTarget = (model: string, value: string) => {
    const rate = value.trim() === '' ? 100 : Number(value);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError('直通率标准必须在 0–100 之间');
      return;
    }
    setError('');
    onChange({ ...targets, [model]: rate });
  };

  const addModel = () => {
    const model = newModel.trim();
    if (!model) return;
    if (Object.prototype.hasOwnProperty.call(targets, model)) {
      setError(`机型“${model}”已存在`);
      return;
    }
    const rate = newTarget.trim() === '' ? 100 : Number(newTarget);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError('直通率标准必须在 0–100 之间');
      return;
    }
    onChange({ ...targets, [model]: rate });
    setNewModel('');
    setNewTarget('100');
    setError('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">直通率标准配置</h3>
          <p className="mt-1 text-xs text-slate-500">未配置机型默认标准为 100%</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void downloadTemplate()} disabled={locked} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            下载模板
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={locked} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {busy === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            导入模板
          </button>
          <input ref={fileInput} aria-label="选择直通率标准模板" type="file" accept=".xlsx,.xls" hidden onChange={event => void importTemplate(event)} />
        </div>
      </div>
      {error && <p role="alert" className="max-h-28 shrink-0 overflow-auto whitespace-pre-line text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="shrink-0 text-sm text-emerald-700">{message}</p>}
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input aria-label="搜索机型" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="搜索机型" className="h-9 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
        </div>
        <span className="shrink-0 text-xs text-slate-500">{entries.length} 个机型</span>
      </div>
      <div className="min-h-24 flex-1 overflow-auto border-y border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">机型名称</th>
              <th className="px-3 py-2 font-medium">直通率标准 (%)</th>
              <th className="w-12 px-2 py-2"><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {visible.map(([model, target]) => (
              <tr key={model} className="hover:bg-slate-50">
                <td className="break-all px-3 py-2 font-medium text-slate-800">{model}</td>
                <td className="px-3 py-2">
                  <input aria-label={`${model} 直通率标准`} type="number" min="0" max="100" step="any" value={target} disabled={locked} onChange={event => changeTarget(model, event.target.value)} className="h-8 w-24 max-w-full rounded border border-slate-300 px-2 text-right text-sm outline-none focus:border-blue-500 disabled:opacity-50" />
                </td>
                <td className="px-2 py-2">
                  <button type="button" disabled={locked} onClick={() => { const next = { ...targets }; delete next[model]; onChange(next); }} aria-label={`删除 ${model}`} title={`删除 ${model}`} className="flex h-8 w-8 items-center justify-center rounded text-red-500 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
            {!visible.length && <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-slate-400">{search ? '未找到匹配机型' : '暂无已配置机型'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 text-xs text-slate-500">
        <span>{currentPage + 1} / {pages}</span>
        <button type="button" aria-label="上一页" title="上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" aria-label="下一页" title="下一页" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2 border-t border-slate-200 pt-3">
        <label className="min-w-0 text-xs text-slate-600">新增机型
          <input value={newModel} onChange={event => setNewModel(event.target.value)} disabled={locked} className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-blue-500" />
        </label>
        <label className="text-xs text-slate-600">目标 (%)
          <input type="number" min="0" max="100" step="any" value={newTarget} onChange={event => setNewTarget(event.target.value)} disabled={locked} className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-blue-500" />
        </label>
        <button type="button" disabled={locked || !newModel.trim()} onClick={addModel} className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-slate-800 px-3 text-sm text-white hover:bg-slate-700 disabled:opacity-50"><Plus className="h-4 w-4" />添加</button>
      </div>
    </div>
  );
}
