import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Download, Layers3, PackageSearch, RefreshCw, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { apiFetch, requestData } from '../api/authApi';
import { MultiSelect } from '../components/shared/MultiSelect';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { IncomingMaterialImage, type IncomingPhoto } from '../components/shared/IncomingMaterialImage';
import { API_BASE_URL } from '../constants';

type RecordRow = Record<string, unknown>;
interface Result { queriedAt: string; upstreamTotal: number | null; readCount: number; matchedCount: number; complete: boolean; rows: RecordRow[] }
interface Filters { keyword: string; bases: string[]; material: string[]; supplier: string[]; order: string[]; lot: string[]; category: string[]; date_from: string; date_to: string }
const EMPTY: Filters = { keyword: '', bases: [], material: [], supplier: [], order: [], lot: [], category: [], date_from: '', date_to: '' };
const bases: Record<string, string> = { TJ: '天津', PJ: '盘锦', KS: '昆山', TY: '太原', AY: '安阳', TX: '桐乡', DT: '大同', QD: '青岛', ML: '马来', '1000': '天津', '2000': '盘锦', '3000': '昆山', '7000': '太原', '8000': '安阳', '9000': '桐乡', D000: '大同' };
const columns = [
  ['prueflos', '检验批号'], ['selmatnr', '物料编号'], ['ktextmat', '物料描述'],
  ['losmenge', '到货数量'], ['supplier', '供应商'], ['supplier_code', '供应商代码'],
  ['location_info', '库位信息'], ['pastrterm', '到货日期'], ['ebeln', '订单号'],
  ['duration', '解决时长（H）'], ['cost', '质量成本'], ['basecode', '基地'],
  ['abnormal_describe', '异常描述'], ['bad_img', '不良图片'], ['abnormal_class', '异常分类'],
  ['first_arrival', '首件'], ['bad_num', '不良数量'], ['entry_date', '录入日期'],
  ['creator', '创建人'], ['solution', '解决方案'], ['actual_date', '处理日期'],
  ['business_unit', '责任单位'], ['person_liable', '责任人'], ['cause_analysis', '原因分析'],
  ['report_attachment', '8D报告路径'], ['event_type', '事件类型'], ['material_state', '物料状态'],
  ['states', '状态'], ['remark', '备注'], ['handler', '处理人'], ['modifier', '修改人'],
  ['modifier_data', '修改时间'], ['receive_email', '接收邮件人'], ['creator_user', '创建人'],
] as const;
const names: Record<string, string> = { ...Object.fromEntries(columns), bad_num: '不良数量', losmenge: '到货数量', entry_date: '录入日期', solution: '解决方案', cause_analysis: '原因分析', improve: '改善对策', remark: '备注', creator: '创建人', handler: '处理人' };
const show = (value: unknown) => value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const displayBase = (value: unknown) => bases[show(value).trim().toUpperCase()] || show(value);
const inputClass = 'mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10';
const fieldLabels: Record<keyof Filters, string> = { keyword: '关键词', bases: '基地', material: '物料编号', supplier: '供应商', order: '订单号', lot: '检验批号', category: '异常分类', date_from: '到货开始日期', date_to: '到货结束日期' };
const selectFields = { material: 'selmatnr', supplier: 'supplier', order: 'ebeln', lot: 'prueflos', category: 'abnormal_class' } as const;
type SelectField = keyof typeof selectFields;

function distribution(rows: RecordRow[], field: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = field === 'basecode' ? displayBase(row[field]) : show(row[field]);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
}

function filesFor(row: RecordRow, field: '_incomingPhotos' | '_incomingReports'): IncomingPhoto[] {
  const files = row[field];
  return Array.isArray(files) ? files.filter((photo): photo is IncomingPhoto =>
    Boolean(photo && typeof photo.path === 'string' && typeof photo.accessToken === 'string')) : [];
}

function PhotoStrip({ row, onPreview }: { row: RecordRow; onPreview: (photo: IncomingPhoto) => void }) {
  const photos = filesFor(row, '_incomingPhotos');
  if (!photos.length) return <span className="text-xs text-slate-400">暂无图片</span>;
  return <div className="flex max-w-56 gap-1 overflow-x-auto">{photos.map((photo, index) =>
    <button type="button" key={`${photo.path}-${index}`} onClick={() => onPreview(photo)} aria-label={`查看第 ${index + 1} 张不良图片`} className="shrink-0 rounded focus-visible:outline-2 focus-visible:outline-cyan-600">
      <IncomingMaterialImage photo={photo} alt={`不良图片 ${index + 1}`} />
    </button>)}</div>;
}

function ReportLinks({ row }: { row: RecordRow }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const reports = filesFor(row, '_incomingReports');
  const download = async (file: IncomingPhoto) => {
    setDownloading(file.path); setError('');
    try {
      const params = new URLSearchParams({ path: file.path, accessToken: file.accessToken });
      const response = await apiFetch(`${API_BASE_URL}/incoming-materials/report?${params}`);
      if (!response.ok) throw new Error('下载失败，请刷新后重试');
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = file.path.split('/').pop() || '8D报告';
      document.body.appendChild(anchor);
      anchor.click(); anchor.remove(); URL.revokeObjectURL(objectUrl);
    } catch {
      setError('下载失败，请刷新后重试');
    } finally { setDownloading(null); }
  };
  if (!reports.length) return <span className="text-xs text-slate-400">暂无报告</span>;
  return <div className="space-y-1">{reports.map((file, index) => {
    const filename = file.path.split('/').pop() || '8D报告';
    return <button type="button" key={`${file.path}-${index}`} title={filename} disabled={downloading !== null} onClick={() => void download(file)} className="block max-w-full truncate text-left text-xs text-cyan-700 underline hover:text-cyan-900 disabled:opacity-50">{downloading === file.path ? '正在下载：' : ''}{filename}</button>;
  })}{error && <span role="alert" className="text-xs text-rose-700">{error}</span>}</div>;
}

function matchesFilters(row: RecordRow, filters: Filters): boolean {
  if (filters.bases.length && !filters.bases.includes(displayBase(row.basecode))) return false;
  for (const key of Object.keys(selectFields) as SelectField[]) {
    const value = String(row[selectFields[key]] ?? '').trim();
    if (filters[key].length && !filters[key].includes(value)) return false;
  }
  if (filters.date_from || filters.date_to) {
    const arrival = String(row.pastrterm ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival) ||
      (filters.date_from && arrival < filters.date_from) || (filters.date_to && arrival > filters.date_to)) return false;
  }
  if (filters.keyword) {
    const needle = filters.keyword.toLocaleLowerCase();
    if (!Object.entries(row).some(([key, value]) => !['_incomingPhotos', '_incomingReports'].includes(key) && JSON.stringify(value ?? null)?.toLocaleLowerCase().includes(needle))) return false;
  }
  return true;
}

export default function IncomingMaterialsPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Filters>({ ...EMPTY });
  const [filters, setFilters] = useState<Filters>({ ...EMPTY });
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<RecordRow | null>(null);
  const [preview, setPreview] = useState<IncomingPhoto | null>(null);
  const requestId = useRef(0);
  const refresh = useCallback(() => { setPage(1); setRevision(value => value + 1); }, []);
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true); setError(''); setResult(null);
    requestData<Result>(`${API_BASE_URL}/incoming-materials/realtime`).then(data => {
      if (id === requestId.current) setResult(data);
    }).catch(err => {
      if (id === requestId.current) setError(err instanceof Error ? err.message : '查询失败');
    }).finally(() => { if (id === requestId.current) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [revision]);
  useEffect(() => {
    if (!detail || preview) return;
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [detail, preview]);
  useEffect(() => {
    if (!preview) return;
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);
  const filteredRows = useMemo(() => (result?.rows ?? []).filter(row => matchesFilters(row, filters)), [result, filters]);
  const options = useMemo(() => {
    const data = result?.rows ?? [];
    const distinct = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return {
      bases: distinct(data.map(row => row.basecode == null || String(row.basecode).trim() === '' ? '' : displayBase(row.basecode))),
      ...Object.fromEntries((Object.keys(selectFields) as SelectField[]).map(key => [key,
        distinct(data.map(row => String(row[selectFields[key]] ?? '').trim())),
      ])) as Record<SelectField, string[]>,
    };
  }, [result]);
  const byBase = useMemo(() => distribution(filteredRows, 'basecode'), [filteredRows]);
  const byCategory = useMemo(() => distribution(filteredRows, 'abnormal_class'), [filteredRows]);
  const active = Object.entries(filters).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value));
  const invalidDates = Boolean(draft.date_from && draft.date_to && draft.date_from > draft.date_to);
  const setField = (key: 'keyword' | 'date_from' | 'date_to', value: string) => setDraft(current => ({ ...current, [key]: value }));
  const search = (event: FormEvent) => {
    event.preventDefault();
    if (invalidDates) return;
    const next = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Array.isArray(value) ? value : value.trim()])) as unknown as Filters;
    setPage(1); setDetail(null);
    setFilters(next);
  };
  const reset = () => { setDraft({ ...EMPTY }); setFilters({ ...EMPTY }); setPage(1); setDetail(null); };
  const exportData = () => {
    const values = filteredRows.map(row => columns.map(([key]) => {
      if (key === 'basecode') return displayBase(row.basecode);
      if (key === 'bad_img' || key === 'report_attachment') {
        return filesFor(row, key === 'bad_img' ? '_incomingPhotos' : '_incomingReports')
          .map(file => `http://10.2.20.22:9991/${file.path}`).join('\n');
      }
      const value = row[key];
      return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value;
    }));
    const sheet = XLSX.utils.aoa_to_sheet([columns.map(([, label]) => label), ...values]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '异常记录明细');
    XLSX.writeFile(workbook, '来料异常明细.xlsx');
  };
  const pages = Math.max(1, Math.ceil(filteredRows.length / 30));
  const rows = filteredRows.slice((page - 1) * 30, page * 30);

  return <div className="min-h-screen bg-[#f4f7fb] text-slate-800">
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1900px] items-center gap-3 px-4 py-3 sm:px-6">
        <button onClick={() => navigate('/')} aria-label="返回首页" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><ArrowLeft className="size-4" /></button>
        <span className="flex size-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700"><PackageSearch className="size-5" /></span>
        <div className="min-w-0 flex-1"><h1 className="font-bold tracking-tight text-slate-950">来料异常看板</h1><p className="text-xs text-slate-500">质量监控 / 来料异常</p></div>
        <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 sm:inline-flex"><span className="size-1.5 rounded-full bg-emerald-500" />按需刷新</span>
        <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? 'motion-safe:animate-spin' : ''}`} />刷新</button>
      </div>
    </header>
    <main className="mx-auto max-w-[1900px] space-y-3 p-3 sm:p-4">
      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div className="flex items-center gap-2"><span className="rounded-lg bg-cyan-50 p-2 text-cyan-700"><SlidersHorizontal className="size-4" /></span><div><h2 className="text-sm font-bold text-slate-900">筛选条件</h2><p className="mt-0.5 text-xs text-slate-400">筛选当前已加载的全部可访问数据</p></div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{active.length ? `已应用 ${active.length} 项条件` : '全部数据'}</span></div>
        <form onSubmit={search} className="p-4"><div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">关键词（搜索所有字段）<input value={draft.keyword} onChange={e => setField('keyword', e.target.value)} maxLength={200} placeholder="物料、供应商、订单等" className={inputClass} /></label>
          <MultiSelect label="基地" options={options.bases} value={draft.bases} onChange={value => setDraft(current => ({ ...current, bases: value }))} />
          {(Object.keys(selectFields) as SelectField[]).map(key => <MultiSelect key={key} label={fieldLabels[key]} options={options[key]} value={draft[key]} onChange={value => setDraft(current => ({ ...current, [key]: value }))} />)}
          <DateRangePicker label="到货日期" from={draft.date_from} to={draft.date_to} allowOpenEnded onChange={(from, to) => setDraft(current => ({ ...current, date_from: from, date_to: to }))} />
        </div>{invalidDates && <p role="alert" className="mt-3 text-xs text-red-600">到货开始日期不能晚于结束日期</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"><button type="submit" disabled={loading || invalidDates || !result} className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-800 disabled:opacity-50"><Search className="size-4" />筛选数据</button><button type="button" onClick={reset} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"><RotateCcw className="size-4" />清空</button><button type="button" onClick={exportData} disabled={loading || !result || !filteredRows.length} className="inline-flex items-center gap-2 rounded-lg border border-cyan-200 px-4 py-2 text-sm font-medium text-cyan-700 transition hover:bg-cyan-50 disabled:opacity-50"><Download className="size-4" />导出数据</button><p className="ml-auto text-xs text-slate-400">导出当前筛选结果</p></div></form>
      </section>
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</div>}
      {loading && <div role="status" className="flex items-center gap-3 rounded-xl border border-cyan-100 bg-white p-6 text-sm text-slate-500"><RefreshCw className="size-5 text-cyan-600 motion-safe:animate-spin" />正在读取上游数据，请稍候…</div>}
      {result && <div className="space-y-3 motion-safe:animate-[login-entry_400ms_ease-out_both]">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" />{result.complete ? '已读取全部上游分页' : '数据未完整读取，不代表全量数据'}</span><span>更新于 {new Date(result.queriedAt).toLocaleString('zh-CN')}</span></div>
        {active.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium text-slate-500">已应用：</span>{active.map(([key, value]) => <span key={key} className="rounded-full border border-cyan-100 bg-cyan-50 px-2.5 py-1 text-cyan-700">{fieldLabels[key as keyof Filters]}：{Array.isArray(value) ? value.join('、') : value}</span>)}</div>}
        <section className="grid gap-3 lg:grid-cols-2">{[{ title: '基地分布', subtitle: '当前结果 · 前 5 个基地', data: byBase, bar: 'bg-cyan-500', icon: Layers3 }, { title: '异常分类', subtitle: '当前结果 · 前 5 个分类', data: byCategory, bar: 'bg-violet-500', icon: AlertCircle }].map(({ title, subtitle, data, bar, icon: Icon }) => <div key={title} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><span className="rounded-lg bg-slate-50 p-2 text-slate-500"><Icon className="size-4" /></span><div><h3 className="text-sm font-bold text-slate-900">{title}</h3><p className="text-xs text-slate-400">{subtitle}</p></div></div>{data.length ? <div className="space-y-2">{data.map(([label, count]) => <div key={label} className="flex items-center gap-3 text-xs"><span className="w-24 truncate text-slate-600" title={label}>{label}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${bar} transition-[width] duration-500 motion-reduce:transition-none`} style={{ width: `${count / data[0][1] * 100}%` }} /></div><span className="w-10 text-right font-semibold tabular-nums text-slate-700">{count}</span></div>)}</div> : <p className="py-6 text-center text-xs text-slate-400">暂无可统计数据</p>}</div>)}</section>
        <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold text-slate-900">异常记录明细</h2><span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-700">库位匹配 *N00</span></div><p className="mt-1.5 text-xs text-slate-500">仅显示库位信息以 N00 结尾的记录，如 DN00、9N00。</p><p className="mt-1 text-xs text-slate-400">共 {filteredRows.length.toLocaleString()} 条 · 点击详情查看完整字段</p></div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-left text-sm"><thead className="bg-slate-50/80 text-xs text-slate-500"><tr>{columns.map(([key, label]) => <th key={key} className="whitespace-nowrap px-3 py-2.5 font-semibold">{label}</th>)}<th className="px-4 py-3">操作</th></tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)} className="border-t border-slate-100 transition-colors hover:bg-cyan-50/40">{columns.map(([key]) => <td key={key} className="max-w-56 px-3 py-2.5">{key === 'bad_img' ? <PhotoStrip row={row} onPreview={setPreview} /> : key === 'report_attachment' ? <ReportLinks row={row} /> : <div className={key === 'location_info' ? 'inline-flex rounded-md bg-cyan-50 px-2 py-1 font-semibold text-cyan-700' : 'truncate text-slate-600'} title={show(row[key])}>{key === 'basecode' ? displayBase(row[key]) : show(row[key])}</div>}</td>)}<td className="px-4 py-3"><button onClick={() => setDetail(row)} className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-cyan-700 hover:text-cyan-900">详情<ArrowRight className="size-3" /></button></td></tr>)}</tbody></table></div>
          {rows.length === 0 && <div className="p-10 text-center"><PackageSearch className="mx-auto size-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-500">没有符合条件的记录</p><p className="mt-1 text-xs text-slate-400">可调整筛选条件后重新查询</p></div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-500"><span className="text-xs">每页 30 条 · 第 {page} / {pages} 页</span><div className="flex items-center gap-2"><button aria-label="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="size-4" /></button><button aria-label="下一页" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="size-4" /></button></div></div>
        </section>
      </div>}
    </main>
    {detail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={() => setDetail(null)}><section role="dialog" aria-modal="true" aria-labelledby="incoming-detail-title" onClick={event => event.stopPropagation()} className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 pb-4"><div><h2 id="incoming-detail-title" className="font-bold text-slate-900">异常记录详情</h2><p className="mt-1 text-xs text-slate-400">查看这条记录的完整字段</p></div><button autoFocus onClick={() => setDetail(null)} aria-label="关闭详情" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-5" /></button></div><dl className="mt-4 grid gap-4 sm:grid-cols-2">{Object.entries(detail).filter(([key]) => key !== '_incomingPhotos' && key !== '_incomingReports').map(([key, value]) => <div key={key} className="min-w-0 border-b border-slate-100 pb-3"><dt className="text-xs font-medium text-slate-400">{names[key] ?? key}</dt><dd className="mt-1 whitespace-pre-wrap break-all text-sm text-slate-700">{key === 'bad_img' ? <PhotoStrip row={detail} onPreview={setPreview} /> : key === 'report_attachment' ? <ReportLinks row={detail} /> : key === 'basecode' ? displayBase(value) : show(value)}</dd></div>)}</dl></section></div>}
    {preview && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4" onClick={() => setPreview(null)}><section role="dialog" aria-modal="true" aria-label="不良图片预览" onClick={event => event.stopPropagation()} className="relative flex max-h-[90vh] max-w-[95vw] items-center justify-center rounded-lg bg-white p-4"><button autoFocus type="button" aria-label="关闭图片预览" onClick={() => setPreview(null)} className="absolute right-2 top-2 rounded bg-white/90 p-2 text-slate-700 shadow"><X className="size-5" /></button><IncomingMaterialImage photo={preview} alt="不良图片大图" large /></section></div>}
  </div>;
}
