import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, Boxes, Building2, CalendarDays,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Layers3, RefreshCw,
  RotateCcw, Search, SlidersHorizontal, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { requestData } from '../api/authApi';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { API_BASE_URL } from '../constants';
import { useAuth } from '../context/AuthContext';

type Row = Record<string, unknown>;

interface QueryResult { upstreamTotal: number; readCount: number; complete: boolean; queriedAt: string; rows: Row[] }
interface FilterOption { value: string; label: string }
interface OptionsResult {
  factories: FilterOption[];
  errTypes: Record<string, string[]>;
  models: string[];
  causedBy: string[];
  orders: string[];
  salesReceipts: string[];
  states: FilterOption[];
}
interface Filters {
  factory: string;
  models: string;
  orderID: string;
  errTypeFirst: string;
  errTypeSecond: string;
  salesReceipts: string;
  createTimeStart: string;
  createTimeEnd: string;
  state: string;
  causedBy: string;
}

const UPSTREAM_FACTORIES: FilterOption[] = [
  { value: '1000', label: '天津' }, { value: '2000', label: '盘锦' }, { value: '3000', label: '昆山' },
  { value: 'Q000', label: '青岛' }, { value: '7000', label: '太原' }, { value: '8000', label: '安阳' },
  { value: '9000', label: '桐乡' }, { value: 'D000', label: '大同' },
];
// 基地权限编码 → 上游工厂编码；马来（ML）在上游没有对应工厂。
const BASE_TO_FACTORY: Record<string, string | null> = {
  '1000': '1000', TJ: '1000', 天津: '1000',
  '2000': '2000', PJ: '2000', 盘锦: '2000',
  '3000': '3000', KS: '3000', 昆山: '3000',
  QD: 'Q000', Q000: 'Q000', 青岛: 'Q000',
  '7000': '7000', TY: '7000', 太原: '7000',
  '8000': '8000', AY: '8000', 安阳: '8000',
  '9000': '9000', TX: '9000', 桐乡: '9000',
  D000: 'D000', DT: 'D000', 大同: 'D000',
  ML: null, 马来: null,
};
const STATE_LABELS: Record<string, string> = { Open: '未关闭', Closed: '已关闭' };
const PAGE_SIZE = 20;

const tableColumns = [
  ['createTime', '录入时间'], ['factory', '基地'], ['models', '生产机型'], ['orderID', '生产订单'],
  ['salesReceipts', '销售订单'], ['materialSn', '物料SN'], ['errTypeFirst', '一级类型'],
  ['errTypeSecond', '二级类型'], ['errNum', '异常台数'], ['productionCount', '生产数量'],
  ['productionGrade', '等级'], ['causedBy', '责任单位'], ['state', '状态'],
] as const;

const detailLabels: Record<string, string> = {
  id: '异常ID', factory: '基地', state: '处理状态', exceptionId: '异常单号', orderID: '生产订单',
  salesReceipts: '销售订单', materialSn: '物料SN', models: '生产机型', productionCount: '生产数量',
  errNum: '异常台数', productType: '产品类型', customerId: '客户编码', createTime: '录入时间',
  errTypeFirst: '一级类型', errTypeSecond: '二级类型', errDesc: '异常描述', tempMeasure: '临时处理措施',
  causeAnalysis: '原因分析', improveStrategy: '改善对策', customizationIssues: '是否定制问题',
  caseScore: '案例评分', productionGrade: '生产等级', salesBatchEvents: '销售批次事件',
  responsibleBy: '责任人工号', responsibleByNames: '责任人', causedBy: '责任单位', createdBy: '创建人工号',
  createdByName: '创建人', repairedBy: '处理人工号', repairedByNames: '处理人', repairedTime: '处理时间',
  errTimes: '异常时长（H）', workingHours: '处理工时（H）', delayTime: '延时（H）',
  modifiedBy: '修改人工号', modifiedByName: '修改人', updateTime: '更新时间', remarks: '备注', versionTotal: '版本数',
};

const fieldLabels: Record<keyof Filters, string> = {
  factory: '基地', models: '生产机型', orderID: '生产订单', errTypeFirst: '一级类型',
  errTypeSecond: '二级类型', salesReceipts: '销售订单', createTimeStart: '录入开始日期',
  createTimeEnd: '录入结束日期', state: '处理状态', causedBy: '责任单位',
};

const show = (value: unknown) =>
  value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const stateLabel = (value: unknown) => STATE_LABELS[String(value ?? '')] ?? show(value);
const pad = (value: number) => String(value).padStart(2, '0');
const formatDate = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

function defaultFilters(factory: string): Filters {
  return {
    factory,
    models: '',
    orderID: '',
    errTypeFirst: '',
    errTypeSecond: '',
    salesReceipts: '',
    createTimeStart: formatDate(new Date(Date.now() - 30 * 86_400_000)),
    createTimeEnd: formatDate(new Date()),
    state: '',
    causedBy: '',
  };
}

function initialFactory(basePermissions: string[] | null | undefined): string {
  if (basePermissions == null) return '';
  for (const code of basePermissions) {
    const factory = BASE_TO_FACTORY[code];
    if (factory) return factory;
  }
  return '';
}

const inputClass =
  'mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const labelClass = 'text-xs font-semibold text-slate-600';

type DistributionEntry = { raw: string; label: string; count: number };

function distribution(rows: Row[], read: (row: Row) => string, label: (raw: string) => string): DistributionEntry[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = read(row);
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return [...counts]
    .map(([raw, count]) => ({ raw, label: label(raw), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
}

// 四张独立分布卡：每个维度一块，点击条目可下钻明细。
function DistributionCard({
  title, field, subtitle, entries, bar, icon: Icon, onSelect, selected,
}: {
  title: string;
  field: keyof Filters;
  subtitle: string;
  entries: DistributionEntry[];
  bar: string;
  icon: typeof AlertTriangle;
  onSelect: (entry: DistributionEntry) => void;
  selected: { field: string; raw: string } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, 5);
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-lg p-2 ${bar.replace('500', '50')} text-slate-700`}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500">
          {entries.length}
        </span>
      </div>
      {visible.length ? (
        <div className={expanded ? 'max-h-80 space-y-1 overflow-y-auto pr-1' : 'space-y-1'}>
          {visible.map((entry) => {
            const top = entries[0]?.count || 1;
            const body = (
              <>
                <span className="w-28 shrink-0 truncate text-slate-600" title={entry.label}>{entry.label}</span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className={`block h-full rounded-full ${bar} transition-[width] duration-500 motion-reduce:transition-none`}
                    style={{ width: `${(entry.count / top) * 100}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-slate-700">{entry.count}</span>
              </>
            );
            return entry.raw ? (
              <button
                type="button"
                key={entry.raw}
                aria-label={`按${title}筛选：${entry.label}`}
                aria-pressed={selected?.field === field && selected.raw === entry.raw}
                title="点击按该条件查看明细"
                onClick={() => onSelect(entry)}
                className="flex w-full items-center gap-3 rounded px-1 py-1 text-left text-xs transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600 aria-pressed:bg-blue-100/70"
              >
                {body}
              </button>
            ) : (
              <div key={entry.label} className="flex w-full items-center gap-3 rounded px-1 py-1 text-xs text-slate-400" title="上游未填写该字段">
                {body}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-6 text-center text-xs text-slate-400">暂无可统计数据</p>
      )}
      {entries.length > 5 && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            aria-label={`${expanded ? '收起' : '展开更多'}${title}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
          >
            {expanded ? '收起' : '展开更多'}
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}

export default function BatchExceptionPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [initial] = useState(() => defaultFilters(initialFactory(user?.basePermissions)));
  const [draft, setDraft] = useState<Filters>({ ...initial });
  const [applied, setApplied] = useState<Filters>({ ...initial });
  const [revision, setRevision] = useState(0);
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [options, setOptions] = useState<OptionsResult | null>(null);
  const [error, setError] = useState('');
  const [optionsError, setOptionsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [expandedFilters, setExpandedFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Row | null>(null);
  const [selection, setSelection] = useState<{ field: keyof Filters; raw: string; label: string; title: string } | null>(null);
  const detailSection = useRef<HTMLElement>(null);
  const requestId = useRef(0);
  const optionsId = useRef(0);

  const factoryOptions: FilterOption[] = useMemo(() => {
    const fromServer = options?.factories;
    if (fromServer) return fromServer;
    return initial.factory
      ? UPSTREAM_FACTORIES.filter((item) => item.value === initial.factory)
      : [{ value: '', label: '全部基地' }, ...UPSTREAM_FACTORIES];
  }, [options, initial.factory]);

  const refresh = useCallback(() => {
    setPage(1);
    setRevision((value) => value + 1);
    setOptionsRevision((value) => value + 1);
  }, []);

  // 查询：筛选条件由上游实时执行，每次查询都直达最新数据。
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setResult(null);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(applied)) {
      if (value) params.set(key, value);
    }
    requestData<QueryResult>(`${API_BASE_URL}/batch-exception/query?${params}`)
      .then((data) => {
        if (id === requestId.current) setResult(data);
      })
      .catch((err) => {
        if (id === requestId.current) setError(err instanceof Error ? err.message : '查询失败');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    return () => {
      requestId.current += 1;
    };
  }, [applied, revision]);

  // 筛选项：上游没有独立选项接口，由后端按基地抽样推导并缓存。
  useEffect(() => {
    const id = ++optionsId.current;
    setOptionsLoading(true);
    setOptionsError('');
    const params = new URLSearchParams({ factory: draft.factory });
    requestData<OptionsResult>(`${API_BASE_URL}/batch-exception/options?${params}`)
      .then((data) => {
        if (id === optionsId.current) setOptions(data);
      })
      .catch((err) => {
        if (id === optionsId.current) setOptionsError(err instanceof Error ? err.message : '筛选项加载失败');
      })
      .finally(() => {
        if (id === optionsId.current) setOptionsLoading(false);
      });
    return () => {
      optionsId.current += 1;
    };
  }, [draft.factory, optionsRevision]);

  useEffect(() => {
    if (!detail) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [detail]);

  const byErrType = useMemo(
    () => distribution(result?.rows ?? [], (row) => String(row.errTypeFirst ?? '').trim(), (raw) => raw || '未分类'),
    [result],
  );
  const byState = useMemo(
    () => distribution(result?.rows ?? [], (row) => String(row.state ?? '').trim(), stateLabel),
    [result],
  );
  const byCausedBy = useMemo(
    () => distribution(result?.rows ?? [], (row) => String(row.causedBy ?? '').trim(), (raw) => raw || '未填写'),
    [result],
  );
  const byModel = useMemo(
    () => distribution(result?.rows ?? [], (row) => String(row.models ?? '').trim(), (raw) => raw || '未填写'),
    [result],
  );

  const errTypeOptions = useMemo<FilterOption[]>(() => {
    const types = options?.errTypes ?? {};
    return [{ value: '', label: '全部' }, ...Object.keys(types).map((value) => ({ value, label: value }))];
  }, [options]);
  const secondTypeOptions = useMemo<FilterOption[]>(() => {
    const types = options?.errTypes ?? {};
    const list = draft.errTypeFirst
      ? types[draft.errTypeFirst] ?? []
      : [...new Set(Object.values(types).flat())];
    return [{ value: '', label: '全部' }, ...list.map((value) => ({ value, label: value }))];
  }, [options, draft.errTypeFirst]);
  const stateOptions = useMemo<FilterOption[]>(
    () => [{ value: '', label: '全部' }, ...(options?.states ?? [])],
    [options],
  );

  const invalidDates = Boolean(draft.createTimeStart && draft.createTimeEnd && draft.createTimeStart > draft.createTimeEnd);
  const activeCount = useMemo(() => {
    const fieldCount = Object.entries(applied).filter(
      ([key, value]) => key !== 'createTimeStart' && key !== 'createTimeEnd' && Boolean(value),
    ).length;
    const dateChanged =
      applied.createTimeStart !== initial.createTimeStart || applied.createTimeEnd !== initial.createTimeEnd;
    return fieldCount + (dateChanged ? 1 : 0);
  }, [applied, initial]);
  // 收起状态下仍生效的次要条件，用于提示用户。
  const hiddenActiveCount = ['models', 'orderID', 'errTypeSecond', 'salesReceipts', 'causedBy'].filter(
    (key) => Boolean(draft[key as keyof Filters]),
  ).length;

  const runQuery = (next: Filters) => {
    setPage(1);
    setDetail(null);
    setSelection(null);
    setApplied({ ...next });
  };
  const submitSearch = () => {
    if (invalidDates) return;
    runQuery({
      ...draft,
      models: draft.models.trim(),
      orderID: draft.orderID.trim(),
      salesReceipts: draft.salesReceipts.trim(),
      causedBy: draft.causedBy.trim(),
    });
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    submitSearch();
  };
  const reset = () => {
    setDraft({ ...initial });
    runQuery({ ...initial });
  };
  // 分布面板下钻只过滤当前已加载的明细，不改动上游查询条件，可随时清除。
  const drillDown = (field: keyof Filters, raw: string, label: string, title: string) => {
    setPage(1);
    setDetail(null);
    setSelection({ field, raw, label, title });
    detailSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const filteredRows = useMemo(() => {
    const rows = result?.rows ?? [];
    if (!selection) return rows;
    return rows.filter((row) => String(row[selection.field] ?? '').trim() === selection.raw);
  }, [result, selection]);

  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const rows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportData = () => {
    const keys = Object.keys(detailLabels);
    const values = filteredRows.map((row) =>
      keys.map((key) => {
        const value = row[key];
        return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value;
      }),
    );
    const sheet = XLSX.utils.aoa_to_sheet([keys.map((key) => detailLabels[key]), ...values]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '批次异常明细');
    XLSX.writeFile(workbook, '批次异常明细.xlsx');
  };

  const chips = useMemo(() => {
    const list: { key: string; text: string }[] = [];
    if (applied.createTimeStart || applied.createTimeEnd) {
      list.push({ key: 'date', text: `录入日期：${applied.createTimeStart || '不限'} 至 ${applied.createTimeEnd || '不限'}` });
    }
    for (const [key, value] of Object.entries(applied)) {
      if (!value || key === 'createTimeStart' || key === 'createTimeEnd') continue;
      const text = key === 'state' ? stateLabel(value) : value;
      list.push({ key, text: `${fieldLabels[key as keyof Filters]}：${text}` });
    }
    return list;
  }, [applied]);

  const setField = (key: keyof Filters, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1900px] items-center gap-3 px-4 py-3 sm:px-6">
          <button onClick={() => navigate('/')} aria-label="返回首页" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
            <ArrowLeft className="size-4" />
          </button>
          <span className="flex size-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-600/25">
            <Layers3 className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-bold tracking-tight text-slate-950">批次异常</h1>
            <p className="text-xs text-slate-500">质量监控 / 批次异常</p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 sm:inline-flex">
            <span className="size-1.5 rounded-full bg-blue-500" />实时查询第三方源
          </span>
          <button
            onClick={refresh}
            disabled={loading || optionsLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${loading ? 'motion-safe:animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1900px] space-y-3 p-3 sm:p-4">
        {/* 查询工具栏：主条件常驻，次要条件折叠；操作按钮在卡片头部 */}
        <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <span className="rounded-lg bg-blue-50 p-2 text-blue-700"><SlidersHorizontal className="size-4" /></span>
            <div className="mr-1">
              <h2 className="text-sm font-bold text-slate-900">查询条件</h2>
              <p className="mt-0.5 text-xs text-slate-400">条件直接下发到批次异常系统实时执行</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
              {activeCount ? `${activeCount} 项条件生效` : '默认：近 30 天'}
            </span>
            {!expandedFilters && hiddenActiveCount > 0 && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">收起的筛选中有 {hiddenActiveCount} 项生效</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-expanded={expandedFilters}
                aria-controls="batch-exception-advanced-filters"
                onClick={() => setExpandedFilters((value) => !value)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                {expandedFilters ? '收起筛选' : '展开筛选'}
                {expandedFilters ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
              <button
                type="button"
                onClick={exportData}
                disabled={loading || !filteredRows.length}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="size-4" />导出数据
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw className="size-4" />重置
              </button>
              <button
                type="button"
                onClick={submitSearch}
                disabled={loading || invalidDates}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                <Search className="size-4" />查询
              </button>
            </div>
          </div>

          <form onSubmit={search} className="p-4">
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className={labelClass}>
                基地
                <select value={draft.factory} onChange={(event) => setField('factory', event.target.value)} className={inputClass}>
                  {factoryOptions.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <div className="sm:col-span-1">
                <DateRangePicker
                  label="录入日期"
                  from={draft.createTimeStart}
                  to={draft.createTimeEnd}
                  onChange={(from, to) => setDraft((current) => ({ ...current, createTimeStart: from, createTimeEnd: to }))}
                />
              </div>
              <label className={labelClass}>
                一级类型
                <select
                  value={draft.errTypeFirst}
                  onChange={(event) => {
                    const value = event.target.value;
                    const allowed = value ? options?.errTypes[value] ?? [] : null;
                    setDraft((current) => ({
                      ...current,
                      errTypeFirst: value,
                      errTypeSecond: allowed && !allowed.includes(current.errTypeSecond) ? '' : current.errTypeSecond,
                    }));
                  }}
                  className={inputClass}
                >
                  {errTypeOptions.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className={labelClass}>
                处理状态
                <select value={draft.state} onChange={(event) => setField('state', event.target.value)} className={inputClass}>
                  {stateOptions.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            </div>

            {expandedFilters && (
              <div id="batch-exception-advanced-filters" className="mt-3 grid gap-x-4 gap-y-2 border-t border-dashed border-slate-200 pt-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className={labelClass}>
                  生产机型<span className="ml-1 font-normal text-slate-400">（精确）</span>
                  <input
                    list="batch-exception-models"
                    value={draft.models}
                    onChange={(event) => setField('models', event.target.value)}
                    maxLength={100}
                    placeholder="输入后选择"
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  生产订单<span className="ml-1 font-normal text-slate-400">（精确）</span>
                  <input
                    list="batch-exception-orders"
                    value={draft.orderID}
                    onChange={(event) => setField('orderID', event.target.value)}
                    maxLength={50}
                    placeholder="如 30238291"
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  二级类型
                  <select value={draft.errTypeSecond} onChange={(event) => setField('errTypeSecond', event.target.value)} className={inputClass}>
                    {secondTypeOptions.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className={labelClass}>
                  销售订单<span className="ml-1 font-normal text-slate-400">（模糊）</span>
                  <input
                    list="batch-exception-sales"
                    value={draft.salesReceipts}
                    onChange={(event) => setField('salesReceipts', event.target.value)}
                    maxLength={100}
                    placeholder="输入部分即可"
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  责任单位<span className="ml-1 font-normal text-slate-400">（模糊）</span>
                  <input
                    list="batch-exception-caused-by"
                    value={draft.causedBy}
                    onChange={(event) => setField('causedBy', event.target.value)}
                    maxLength={100}
                    placeholder="输入后选择"
                    className={inputClass}
                  />
                </label>
              </div>
            )}

            <datalist id="batch-exception-models">{(options?.models ?? []).map((value) => <option key={value} value={value} />)}</datalist>
            <datalist id="batch-exception-orders">{(options?.orders ?? []).map((value) => <option key={value} value={value} />)}</datalist>
            <datalist id="batch-exception-sales">{(options?.salesReceipts ?? []).map((value) => <option key={value} value={value} />)}</datalist>
            <datalist id="batch-exception-caused-by">{(options?.causedBy ?? []).map((value) => <option key={value} value={value} />)}</datalist>

            {invalidDates && <p role="alert" className="mt-3 text-xs text-rose-600">录入开始日期不能晚于结束日期</p>}
            {optionsError && <p role="alert" className="mt-3 text-xs text-rose-600">筛选项加载失败：{optionsError}（可点击右上角刷新重试）</p>}
            {!optionsError && optionsLoading && <p className="mt-3 text-xs text-slate-400">正在加载筛选项…</p>}
          </form>
        </section>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />{error}
          </div>
        )}
        {loading && (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-blue-100 bg-white p-6 text-sm text-slate-500">
            <RefreshCw className="size-5 text-blue-600 motion-safe:animate-spin" />
            正在查询批次异常系统，请稍候…
          </div>
        )}

        {result && (
          <div className="space-y-3 motion-safe:animate-[login-entry_400ms_ease-out_both]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {result.complete ? '已加载全部匹配记录' : `匹配 ${result.upstreamTotal} 条，超出单次读取上限，请缩小录入日期范围`}
              </span>
              <span>更新于 {new Date(result.queriedAt).toLocaleString('zh-CN')}</span>
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-500">查询条件：</span>
                {chips.map((chip) => <span key={chip.key} className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-blue-700">{chip.text}</span>)}
              </div>
            )}

            <section className="grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-4">
              <DistributionCard
                title="一级类型"
                field="errTypeFirst"
                subtitle="当前结果 · 点击可筛选"
                entries={byErrType}
                bar="bg-amber-500"
                icon={AlertTriangle}
                selected={selection}
                onSelect={(entry) => drillDown('errTypeFirst', entry.raw, entry.label, '一级类型')}
              />
              <DistributionCard
                title="处理状态"
                field="state"
                subtitle="当前结果 · 点击可筛选"
                entries={byState}
                bar="bg-emerald-500"
                icon={AlertCircle}
                selected={selection}
                onSelect={(entry) => drillDown('state', entry.raw, entry.label, '处理状态')}
              />
              <DistributionCard
                title="责任单位"
                field="causedBy"
                subtitle="当前结果 · 按记录数排名"
                entries={byCausedBy}
                bar="bg-violet-500"
                icon={Building2}
                selected={selection}
                onSelect={(entry) => drillDown('causedBy', entry.raw, entry.label, '责任单位')}
              />
              <DistributionCard
                title="生产机型"
                field="models"
                subtitle="当前结果 · 按记录数排名"
                entries={byModel}
                bar="bg-indigo-500"
                icon={Boxes}
                selected={selection}
                onSelect={(entry) => drillDown('models', entry.raw, entry.label, '生产机型')}
              />
            </section>

            <section ref={detailSection} className="scroll-mt-20 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-bold text-slate-900">异常记录明细</h2>
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">{filteredRows.length} 条</span>
                {selection && (
                  <>
                    <span role="status" className="break-all text-xs text-blue-700">
                      {selection.title}：{selection.label} · {filteredRows.length.toLocaleString()} 条
                    </span>
                    <button
                      type="button"
                      onClick={() => { setSelection(null); setPage(1); }}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-700"
                    >
                      <X className="size-3.5" />清除明细筛选
                    </button>
                  </>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1500px] text-left text-sm">
                  <thead className="bg-blue-50/60 text-xs text-slate-600">
                    <tr>
                      {tableColumns.map(([key, label]) => <th key={key} className="whitespace-nowrap px-3 py-2.5 font-semibold">{label}</th>)}
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={String(row.id ?? index)} className="border-t border-slate-100 even:bg-slate-50/50 transition-colors hover:bg-blue-50/60">
                        {tableColumns.map(([key]) => (
                          <td key={key} className="max-w-56 px-3 py-2.5">
                            {key === 'state' ? (
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                String(row.state) === 'Open' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                              }`}>{stateLabel(row.state)}</span>
                            ) : key === 'productionGrade' && row.productionGrade ? (
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                String(row.productionGrade) === '重大' ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-slate-100 text-slate-600'
                              }`}>{String(row.productionGrade)}</span>
                            ) : (
                              <div className="truncate text-slate-600" title={show(row[key])}>{show(row[key])}</div>
                            )}
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setDetail(row)}
                            className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-blue-700 hover:text-blue-900"
                          >
                            详情<ArrowRight className="size-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && (
                <div className="p-10 text-center">
                  <Layers3 className="mx-auto size-8 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-500">没有符合条件的记录</p>
                  <p className="mt-1 text-xs text-slate-400">可调整查询条件后重新查询</p>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
                <span className="text-xs">每页 {PAGE_SIZE} 条 · 第 {page} / {pages} 页 · 共 {filteredRows.length} 条</span>
                <div className="flex items-center gap-2">
                  <button aria-label="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 p-2 hover:bg-blue-50 disabled:opacity-40">
                    <ChevronLeft className="size-4" />
                  </button>
                  <button aria-label="下一页" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 p-2 hover:bg-blue-50 disabled:opacity-40">
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* 详情改为右侧抽屉，与来料质量的居中弹窗区分 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-exception-detail-title"
            onClick={(event) => event.stopPropagation()}
            className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl motion-safe:animate-[login-entry_400ms_ease-out_both]"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 id="batch-exception-detail-title" className="font-bold text-slate-900">批次异常详情</h2>
                <p className="mt-1 text-xs text-slate-400">完整字段，按信息分组展示</p>
              </div>
              <button autoFocus onClick={() => setDetail(null)} aria-label="关闭详情" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              <dl className="grid gap-4 sm:grid-cols-2">
                {Object.entries(detail).map(([key, value]) => (
                  <div key={key} className="min-w-0 border-b border-slate-100 pb-3">
                    <dt className="text-xs font-medium text-slate-400">{detailLabels[key] ?? key}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-all text-sm text-slate-700">
                      {key === 'state' ? stateLabel(value) : show(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="border-t border-slate-100 px-6 py-3 text-right">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                关闭
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
