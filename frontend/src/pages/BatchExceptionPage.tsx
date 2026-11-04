import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, CalendarDays,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Layers3, Pencil, RefreshCw,
  RotateCcw, Search, SlidersHorizontal, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { requestData } from '../api/authApi';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { API_BASE_URL } from '../constants';
import { useAuth } from '../context/AuthContext';

type Row = Record<string, unknown>;
// 合并统计的展示行：锚点行携带组员，其他内容仍按行独立展示。
interface DisplayRow { row: Row; members: Row[] }

interface QueryResult {
  upstreamTotal: number;
  readCount: number;
  complete: boolean;
  queriedAt: string;
  sync: { year: number; fetched: number; inserted: number; syncedAt: string; cached?: boolean };
  rows: Row[];
}
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
const CATEGORY_CHART_FILTER_KEY = 'batch-exception-category-chart-filter-v1';
type EditableFields = { platform: string; customer: string; base: string; errTypeFirst: string; causedBy: string };

const tableColumns = [
  ['sequence', '序号'], ['platform', '平台'], ['customer', '客户'], ['base', '基地'],
  ['errTypeFirst', '批次类别'], ['causedBy', '责任单位'], ['createTime', '录入时间'],
  ['models', '生产机型'], ['orderID', '生产订单'], ['salesReceipts', '销售订单'], ['materialSn', '物料SN'],
  ['errTypeSecond', '二级类型'], ['errNum', '异常台数'], ['productionCount', '生产数量'],
  ['productionGrade', '等级'], ['state', '状态'],
] as const;

const detailLabels: Record<string, string> = {
  sequence: '序号', platform: '平台', customer: '客户', base: '基地', errTypeFirst: '批次类别', causedBy: '责任单位',
  id: '异常ID', factory: '上游基地', state: '处理状态', exceptionId: '异常单号', orderID: '生产订单',
  salesReceipts: '销售订单', materialSn: '物料SN', models: '生产机型', productionCount: '生产数量',
  errNum: '异常台数', productType: '产品类型', customerId: '客户编码', createTime: '录入时间',
  errTypeSecond: '二级类型', errDesc: '异常描述', tempMeasure: '临时处理措施',
  causeAnalysis: '原因分析', improveStrategy: '改善对策', customizationIssues: '是否定制问题',
  caseScore: '案例评分', productionGrade: '生产等级', salesBatchEvents: '销售批次事件',
  responsibleBy: '责任人工号', responsibleByNames: '责任人', createdBy: '创建人工号',
  createdByName: '创建人', repairedBy: '处理人工号', repairedByNames: '处理人', repairedTime: '处理时间',
  errTimes: '异常时长（H）', workingHours: '处理工时（H）', delayTime: '延时（H）',
  modifiedBy: '修改人工号', modifiedByName: '修改人', updateTime: '更新时间', remarks: '备注', versionTotal: '版本数',
};

const fieldLabels: Record<keyof Filters, string> = {
  factory: '基地', models: '生产机型', orderID: '生产订单', errTypeFirst: '批次类别',
  errTypeSecond: '二级类型', salesReceipts: '销售订单', createTimeStart: '录入开始日期',
  createTimeEnd: '录入结束日期', state: '处理状态', causedBy: '责任单位',
};

const show = (value: unknown) =>
  value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const rowSequence = (row: Row) => {
  const sequence = Number(row.sequence);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : null;
};
const stateLabel = (value: unknown) => STATE_LABELS[String(value ?? '')] ?? show(value);
const pad = (value: number) => String(value).padStart(2, '0');
const formatDate = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

function readSavedCategorySelection(): string[] | null {
  try {
    const saved = localStorage.getItem(CATEGORY_CHART_FILTER_KEY);
    if (saved === null) return null;
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function defaultFilters(factory: string): Filters {
  return {
    factory,
    models: '',
    orderID: '',
    errTypeFirst: '',
    errTypeSecond: '',
    salesReceipts: '',
    createTimeStart: `${new Date().getFullYear()}-01-01`,
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

type ChartDatum = { name: string; raw: string; bu: number; nonBu: number };
type CategoryDatum = { name: string; raw: string; value: number };

function isBuResponsibilityUnit(value: unknown): boolean {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[,，;；/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
  return /(?:^|\s)5000\s+bu(?:$|\s)/.test(normalized);
}

function stackedDistribution(rows: Row[], field: 'base' | 'platform' | 'customer'): ChartDatum[] {
  const counts = new Map<string, ChartDatum>();
  for (const row of rows) {
    const raw = String(row[field] ?? '').trim();
    const name = raw || '未填写';
    const current = counts.get(raw) ?? { name, raw, bu: 0, nonBu: 0 };
    // BU/非 BU 只按“责任单位”统计，责任人等其他字段不参与判断。
    if (isBuResponsibilityUnit(row.causedBy)) current.bu += 1;
    else current.nonBu += 1;
    counts.set(raw, current);
  }
  return [...counts.values()].sort((a, b) => (b.bu + b.nonBu) - (a.bu + a.nonBu) || a.name.localeCompare(b.name, 'zh-CN'));
}

function categoryDistribution(rows: Row[]): CategoryDatum[] {
  const counts = new Map<string, CategoryDatum>();
  for (const row of rows) {
    const raw = String(row.errTypeFirst ?? '').trim();
    const name = raw || '未填写';
    const current = counts.get(raw) ?? { name, raw, value: 0 };
    current.value += 1;
    counts.set(raw, current);
  }
  return [...counts.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-CN'));
}

const CHART_COLORS = ['#2563eb', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#ec4899', '#0f766e'];
const chartTick = { fontSize: 10, fill: '#64748b' };
const chartTooltip = { borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' };

function StackedDistributionChart({ title, data, onSelect }: {
  title: string;
  data: ChartDatum[];
  onSelect: (datum: ChartDatum) => void;
}) {
  return (
    <figure className="min-w-0 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm">
      <figcaption className="mb-1 flex items-center justify-between gap-2">
        <h3 className="truncate text-xs font-semibold text-slate-800">{title}</h3>
        <span className="shrink-0 text-[10px] text-slate-400">点击柱形查看明细</span>
      </figcaption>
      {data.length ? (
        <ResponsiveContainer width="100%" height={194} minWidth={0}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, left: -18, bottom: 2 }}
            onClick={(state) => {
              const datum = (state as { activePayload?: Array<{ payload?: ChartDatum }> } | undefined)?.activePayload?.[0]?.payload;
              if (datum) onSelect(datum);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={chartTick} interval={0} angle={data.length > 7 ? -25 : 0} textAnchor={data.length > 7 ? 'end' : 'middle'} height={data.length > 7 ? 46 : 24} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={chartTick} width={28} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={chartTooltip} cursor={{ fill: '#f8fafc' }} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 2 }} iconSize={8} />
            <Bar dataKey="bu" name="BU责任" stackId="responsibility" fill="#2563eb" maxBarSize={34} isAnimationActive={false} />
            <Bar dataKey="nonBu" name="非BU责任" stackId="responsibility" fill="#f59e0b" maxBarSize={34} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : <p className="py-20 text-center text-xs text-slate-400">暂无可统计数据</p>}
    </figure>
  );
}

function CategoryChart({ data, selectedCategories, onSelectedCategoriesChange, onSelect }: {
  data: CategoryDatum[];
  selectedCategories: string[] | null;
  onSelectedCategoriesChange: (value: string[] | null) => void;
  onSelect: (datum: CategoryDatum) => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filteredData = selectedCategories === null
    ? data
    : data.filter((entry) => selectedCategories.includes(entry.raw));
  const total = filteredData.reduce((sum, entry) => sum + entry.value, 0);

  const toggleCategory = (name: string) => {
    const selected = new Set(selectedCategories ?? data.map((entry) => entry.raw));
    if (selected.has(name)) selected.delete(name);
    else selected.add(name);
    onSelectedCategoriesChange(selected.size === data.length ? null : [...selected]);
  };

  return (
    <figure className="min-w-0 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm">
      <figcaption className="mb-1 flex items-center justify-between gap-2">
        <h3 className="truncate text-xs font-semibold text-slate-800">SIMS 批次异常批次类别分布</h3>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] text-slate-400">共 {total.toLocaleString()} 条</span>
          <button
            type="button"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
            className="rounded border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
          >
            类别筛选{selectedCategories === null ? '' : ` (${selectedCategories.length})`}
          </button>
        </div>
      </figcaption>
      {filterOpen && (
        <div className="mb-2 border-y border-slate-100 py-2">
          <div className="mb-1 flex justify-end gap-2">
            <button type="button" onClick={() => onSelectedCategoriesChange(null)} className="text-[10px] font-medium text-blue-700 hover:text-blue-900">全选</button>
            <button type="button" onClick={() => onSelectedCategoriesChange([])} className="text-[10px] font-medium text-slate-500 hover:text-slate-800">清空</button>
          </div>
          <div className="flex max-h-20 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
            {data.map((entry, index) => (
              <label key={entry.raw} className="inline-flex max-w-full items-center gap-1 text-[10px] text-slate-600">
                <input
                  type="checkbox"
                  checked={selectedCategories === null || selectedCategories.includes(entry.raw)}
                  onChange={() => toggleCategory(entry.raw)}
                  className="size-3.5 shrink-0 accent-blue-600"
                />
                <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                <span className="truncate" title={entry.name}>{entry.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {filteredData.length ? (
        <>
          <div className="relative h-[174px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart
                onClick={(state) => {
                  const datum = (state as { activePayload?: Array<{ payload?: CategoryDatum }> } | undefined)?.activePayload?.[0]?.payload;
                  if (datum && filteredData.some((entry) => entry.raw === datum.raw)) onSelect(datum);
                }}
              >
                <Pie data={filteredData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={67} paddingAngle={2} label={false} isAnimationActive={false}>
                  {filteredData.map((entry) => {
                    const colorIndex = data.findIndex((item) => item.raw === entry.raw);
                    return <Cell key={entry.raw} fill={CHART_COLORS[colorIndex % CHART_COLORS.length]} />;
                  })}
                </Pie>
                <Tooltip contentStyle={chartTooltip} formatter={(value) => [`${value} 条`, '异常数']} />
              </PieChart>
            </ResponsiveContainer>
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-semibold leading-5 tabular-nums text-slate-800">{total.toLocaleString()}</span>
              <span className="mt-0.5 text-[10px] text-slate-400">异常总数</span>
            </div>
          </div>
          <div className="mt-1 flex max-h-10 flex-wrap justify-center gap-x-3 gap-y-1 overflow-y-auto text-[10px] text-slate-600">
            {filteredData.map((entry) => {
              const colorIndex = data.findIndex((item) => item.raw === entry.raw);
              return <button key={entry.raw} type="button" className="inline-flex items-center gap-1 whitespace-nowrap hover:text-blue-700" onClick={() => onSelect(entry)}>
                <span className="size-2 rounded-sm" style={{ backgroundColor: CHART_COLORS[colorIndex % CHART_COLORS.length] }} />
                <span>{entry.name}</span>
                <span className="tabular-nums text-slate-400">{entry.value}</span>
              </button>;
            })}
          </div>
        </>
      ) : <p className="py-20 text-center text-xs text-slate-400">{data.length ? '没有选中的批次类别' : '暂无可统计数据'}</p>}
    </figure>
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
  const [selection, setSelection] = useState<{ field: string; raw: string; label: string; title: string } | null>(null);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [editValues, setEditValues] = useState<EditableFields>({ platform: '', customer: '', base: '', errTypeFirst: '', causedBy: '' });
  const [editError, setEditError] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedSequences, setSelectedSequences] = useState<Set<number>>(new Set());
  const [selectedChartCategories, setSelectedChartCategories] = useState<string[] | null>(readSavedCategorySelection);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditValues, setBulkEditValues] = useState({ platform: '', customer: '' });
  const [bulkEditError, setBulkEditError] = useState('');
  const [bulkEditLoading, setBulkEditLoading] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [mergeLoading, setMergeLoading] = useState(false);
  const [unmergeLoading, setUnmergeLoading] = useState(false);
  const [unmergeError, setUnmergeError] = useState('');
  const detailSection = useRef<HTMLElement>(null);
  const requestId = useRef(0);
  const optionsId = useRef(0);

  useEffect(() => {
    try {
      if (selectedChartCategories === null) localStorage.removeItem(CATEGORY_CHART_FILTER_KEY);
      else localStorage.setItem(CATEGORY_CHART_FILTER_KEY, JSON.stringify(selectedChartCategories));
    } catch {
      // The chart remains usable when browser storage is unavailable.
    }
  }, [selectedChartCategories]);

  const factoryOptions: FilterOption[] = useMemo(() => {
    const fromServer = options?.factories;
    if (fromServer) return fromServer;
    return initial.factory
      ? UPSTREAM_FACTORIES.filter((item) => item.value === initial.factory)
      : [{ value: '', label: '全部基地' }, ...UPSTREAM_FACTORIES];
  }, [options, initial.factory]);

  const refresh = useCallback(() => {
    setPage(1);
    setSelectedSequences(new Set());
    setRevision((value) => value + 1);
    setOptionsRevision((value) => value + 1);
  }, []);

  // 每次查询先增量同步本年度新增记录，再从本地数据库读取。
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

  // 统计口径：被合并的记录不再单独计数，由组内锚点行代表整组。
  const statRows = useMemo(
    () => (result?.rows ?? []).filter((row) => row.mergedInto == null),
    [result],
  );
  const baseChart = useMemo(() => stackedDistribution(statRows, 'base'), [statRows]);
  const platformChart = useMemo(() => stackedDistribution(statRows, 'platform'), [statRows]);
  const customerChart = useMemo(() => stackedDistribution(statRows, 'customer'), [statRows]);
  const categoryChart = useMemo(() => categoryDistribution(statRows), [statRows]);

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
    setSelectedSequences(new Set());
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
  const drillDown = (field: string, raw: string, label: string, title: string) => {
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

  // 合并组按“统计单元”分页与计数：锚点行带上组员紧跟其后渲染，组不会被页边界截断；
  // 若锚点被明细筛选拆走，组员退化为独立行展示。
  const groupedRows = useMemo<DisplayRow[]>(() => {
    const sequenceSet = new Set<number>();
    for (const row of filteredRows) {
      const sequence = Number(row.sequence);
      if (Number.isInteger(sequence) && sequence > 0) sequenceSet.add(sequence);
    }
    const membersByAnchor = new Map<number, Row[]>();
    for (const row of filteredRows) {
      if (row.mergedInto == null) continue;
      const anchor = Number(row.mergedInto);
      if (!sequenceSet.has(anchor)) continue;
      const members = membersByAnchor.get(anchor) ?? [];
      members.push(row);
      membersByAnchor.set(anchor, members);
    }
    const display: DisplayRow[] = [];
    for (const row of filteredRows) {
      if (row.mergedInto != null && sequenceSet.has(Number(row.mergedInto))) continue;
      display.push({ row, members: membersByAnchor.get(Number(row.sequence)) ?? [] });
    }
    return display;
  }, [filteredRows]);

  const pages = Math.max(1, Math.ceil(groupedRows.length / PAGE_SIZE));
  const pageGroups = groupedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageRows = pageGroups.flatMap(({ row, members }) => [row, ...members]);
  const visibleSequences = pageRows.map(rowSequence).filter((sequence): sequence is number => sequence !== null);
  const allVisibleSelected = visibleSequences.length > 0 && visibleSequences.every((sequence) => selectedSequences.has(sequence));

  const toggleSequence = (sequence: number) => {
    setSelectedSequences((current) => {
      const next = new Set(current);
      if (next.has(sequence)) next.delete(sequence);
      else next.add(sequence);
      return next;
    });
  };
  const toggleAllVisible = () => {
    setSelectedSequences((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleSequences.forEach((sequence) => next.delete(sequence));
      else visibleSequences.forEach((sequence) => next.add(sequence));
      return next;
    });
  };

  const exportData = () => {
    const keys = Object.keys(detailLabels);
    const orderedRows = groupedRows.flatMap(({ row, members }) => [row, ...members]);
    const values = orderedRows.map((row) =>
      keys.map((key) => {
        const value = row[key];
        return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value;
      }),
    );
    const sheet = XLSX.utils.aoa_to_sheet([keys.map((key) => detailLabels[key]), ...values]);
    // 序号列按合并组写单元格合并，导出结果与页面展示一致。
    const merges: XLSX.Range[] = [];
    let rowIndex = 1;
    for (const { members } of groupedRows) {
      const span = members.length + 1;
      if (span > 1) merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex + span - 1, c: 0 } });
      rowIndex += span;
    }
    if (merges.length) sheet['!merges'] = merges;
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

  const openEditor = (row: Row) => {
    setEditValues({
      platform: String(row.platform ?? ''),
      customer: String(row.customer ?? ''),
      base: String(row.base ?? row.factory ?? ''),
      errTypeFirst: String(row.errTypeFirst ?? ''),
      causedBy: String(row.causedBy ?? ''),
    });
    setEditError('');
    setEditingRow(row);
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingRow?.sequence) return;
    setEditLoading(true);
    setEditError('');
    try {
      await requestData<Row>(`${API_BASE_URL}/batch-exception/${editingRow.sequence}/editable`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editValues),
      });
      setEditingRow(null);
      refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setEditLoading(false);
    }
  };

  const openBulkEditor = () => {
    setBulkEditValues({ platform: '', customer: '' });
    setBulkEditError('');
    setBulkEditOpen(true);
  };

  const saveBulkEdit = async (event: FormEvent) => {
    event.preventDefault();
    const platform = bulkEditValues.platform.trim();
    const customer = bulkEditValues.customer.trim();
    if (!selectedSequences.size || (!platform && !customer)) {
      setBulkEditError('请至少填写平台或客户');
      return;
    }
    setBulkEditLoading(true);
    setBulkEditError('');
    try {
      await requestData<{ updated: number }>(`${API_BASE_URL}/batch-exception/bulk-edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequences: [...selectedSequences],
          ...(platform ? { platform } : {}),
          ...(customer ? { customer } : {}),
        }),
      });
      setBulkEditOpen(false);
      setSelectedSequences(new Set());
      refresh();
    } catch (err) {
      setBulkEditError(err instanceof Error ? err.message : '批量保存失败');
    } finally {
      setBulkEditLoading(false);
    }
  };

  // 待合并列表按当前查询结果展开（跨页选择同样有效），确认后提交这些序号。
  const mergeSelectedRows = useMemo(
    () =>
      [...selectedSequences]
        .sort((a, b) => a - b)
        .map((sequence) => filteredRows.find((row) => rowSequence(row) === sequence))
        .filter((row): row is Row => row !== undefined),
    [filteredRows, selectedSequences],
  );

  const openMergeDialog = () => {
    setMergeError('');
    setMergeOpen(true);
  };

  const saveMerge = async () => {
    const sequences = mergeSelectedRows
      .map(rowSequence)
      .filter((sequence): sequence is number => sequence !== null);
    if (sequences.length < 2) {
      setMergeError('请至少选择两条记录');
      return;
    }
    setMergeLoading(true);
    setMergeError('');
    try {
      await requestData(`${API_BASE_URL}/batch-exception/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequences }),
      });
      setMergeOpen(false);
      setSelectedSequences(new Set());
      refresh();
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : '合并失败');
    } finally {
      setMergeLoading(false);
    }
  };

  const dissolveGroup = async (row: Row) => {
    const sequence = rowSequence(row);
    if (sequence === null) return;
    setUnmergeLoading(true);
    setUnmergeError('');
    try {
      await requestData(`${API_BASE_URL}/batch-exception/unmerge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence }),
      });
      setSelectedSequences(new Set());
      refresh();
    } catch (err) {
      setUnmergeError(err instanceof Error ? err.message : '解散失败');
    } finally {
      setUnmergeLoading(false);
    }
  };

  // 序号列在锚点行上跨组合并展示（rowSpan），组员行不再渲染序号单元格；其余内容不合并。
  const renderBodyCell = (row: Row, key: string, mergedSpan = 1) => (
    <td key={key} className="max-w-56 px-3 py-2.5" rowSpan={key === 'sequence' && mergedSpan > 1 ? mergedSpan : undefined}>
      {key === 'sequence' ? (
        <div className="flex flex-col items-start gap-1">
          <span className="font-mono tabular-nums text-slate-500">{show(row.sequence)}</span>
          {mergedSpan > 1 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200">
              合并 {mergedSpan} 条
              {editMode && (
                <button
                  type="button"
                  disabled={unmergeLoading}
                  onClick={() => dissolveGroup(row)}
                  title="解散该合并组，组内记录恢复独立统计"
                  className="font-semibold text-violet-800 hover:text-violet-950 disabled:opacity-40"
                >
                  解散
                </button>
              )}
            </span>
          )}
        </div>
      ) : key === 'state' ? (
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
  );

  const renderActionCell = (row: Row) => (
    <td className="px-4 py-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => openEditor(row)} className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-blue-700 hover:text-blue-900">
          <Pencil className="size-3.5" />编辑
        </button>
        <button type="button" onClick={() => setDetail(row)} className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-slate-600 hover:text-slate-900">
          详情<ArrowRight className="size-3" />
        </button>
      </div>
    </td>
  );

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
            <span className="size-1.5 rounded-full bg-blue-500" />本地数据库 · 年度增量同步
          </span>
          <button
            onClick={() => {
              setEditMode((current) => !current);
              setSelectedSequences(new Set());
              setUnmergeError('');
            }}
            disabled={loading}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition disabled:opacity-50 ${editMode ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700'}`}
          >
            <Pencil className="size-4" />{editMode ? '退出编辑' : '编辑模式'}
          </button>
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
              <p className="mt-0.5 text-xs text-slate-400">默认查看本年度全部责任单位的记录</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
              {activeCount ? `${activeCount} 项条件生效` : '本年度'}
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
                批次类别（一级类型）
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
                  责任单位<span className="ml-1 font-normal text-slate-400">（精确）</span>
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
            正在查询本地数据库…
          </div>
        )}

        {result && (
          <div className="space-y-3 motion-safe:animate-[login-entry_400ms_ease-out_both]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                本地匹配 {result.readCount.toLocaleString()} 条 · {result.sync.year} 年数据
                {result.sync.cached ? '（24 小时缓存）' : `同步读取 ${result.sync.fetched.toLocaleString()} 条，本次新增 ${result.sync.inserted.toLocaleString()} 条`}
              </span>
              <span>更新于 {new Date(result.queriedAt).toLocaleString('zh-CN')}</span>
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-500">查询条件：</span>
                {chips.map((chip) => <span key={chip.key} className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-blue-700">{chip.text}</span>)}
              </div>
            )}

            <section className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-4">
              <StackedDistributionChart
                title="SIMS 批次异常报告分布 by 生产基地"
                data={baseChart}
                onSelect={(datum) => drillDown('base', datum.raw, datum.name, '基地')}
              />
              <StackedDistributionChart
                title="SIMS 批次异常平台分布"
                data={platformChart}
                onSelect={(datum) => drillDown('platform', datum.raw, datum.name, '平台')}
              />
              <StackedDistributionChart
                title="SIMS 批次异常客户分布"
                data={customerChart}
                onSelect={(datum) => drillDown('customer', datum.raw, datum.name, '客户')}
              />
              <CategoryChart
                data={categoryChart}
                selectedCategories={selectedChartCategories}
                onSelectedCategoriesChange={setSelectedChartCategories}
                onSelect={(datum) => drillDown('errTypeFirst', datum.raw, datum.name, '批次类别')}
              />
            </section>

            <section ref={detailSection} className="scroll-mt-20 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-bold text-slate-900">异常记录明细</h2>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">{applied.causedBy ? `责任单位 = ${applied.causedBy}` : '责任单位：全部'}</span>
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">{groupedRows.length} 条</span>
                {editMode && (
                  <>
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">已选 {selectedSequences.size} 条</span>
                    {unmergeError && <span role="alert" className="text-xs text-rose-600">{unmergeError}</span>}
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={mergeSelectedRows.length < 2 || mergeLoading}
                        onClick={openMergeDialog}
                        title="把选中的记录合并统计为一条"
                        className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                      >
                        <Layers3 className="size-3.5" />合并统计
                      </button>
                      <button
                        type="button"
                        disabled={!selectedSequences.size || bulkEditLoading}
                        onClick={openBulkEditor}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        <Pencil className="size-3.5" />批量修改平台/客户
                      </button>
                    </div>
                  </>
                )}
                {selection && (
                  <>
                    <span role="status" className="break-all text-xs text-blue-700">
                      {selection.title}：{selection.label} · {groupedRows.length.toLocaleString()} 条
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
                <table className="w-full min-w-[1700px] text-left text-sm">
                  <thead className="bg-blue-50/60 text-xs text-slate-600">
                    <tr>
                      {editMode && (
                        <th className="w-10 px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleAllVisible}
                            aria-label="选择当前页全部记录"
                            className="size-4 accent-blue-600"
                          />
                        </th>
                      )}
                      {tableColumns.map(([key, label]) => <th key={key} className="whitespace-nowrap px-3 py-2.5 font-semibold">{label}</th>)}
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageGroups.map(({ row, members }) => (
                      <Fragment key={String(row.sequence ?? row.id)}>
                        <tr className="border-t border-slate-100 even:bg-slate-50/50 transition-colors hover:bg-blue-50/60">
                          {editMode && (
                            <td className="w-10 px-3 py-2.5">
                              {rowSequence(row) !== null && (
                                <input
                                  type="checkbox"
                                  checked={selectedSequences.has(rowSequence(row) as number)}
                                  onChange={() => toggleSequence(rowSequence(row) as number)}
                                  aria-label={`选择序号 ${row.sequence}`}
                                  className="size-4 accent-blue-600"
                                />
                              )}
                            </td>
                          )}
                          {tableColumns.map(([key]) => renderBodyCell(row, key, members.length + 1))}
                          {renderActionCell(row)}
                        </tr>
                        {members.map((member) => (
                          <tr key={String(member.sequence ?? member.id)} className="border-t border-dashed border-slate-100 bg-blue-50/30 transition-colors hover:bg-blue-50/60">
                            {editMode && (
                              <td className="w-10 px-3 py-2.5">
                                {rowSequence(member) !== null && (
                                  <input
                                    type="checkbox"
                                    checked={selectedSequences.has(rowSequence(member) as number)}
                                    onChange={() => toggleSequence(rowSequence(member) as number)}
                                    aria-label={`选择序号 ${member.sequence}`}
                                    className="size-4 accent-blue-600"
                                  />
                                )}
                              </td>
                            )}
                            {tableColumns.filter(([key]) => key !== 'sequence').map(([key]) => renderBodyCell(member, key))}
                            {renderActionCell(member)}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {pageGroups.length === 0 && (
                <div className="p-10 text-center">
                  <Layers3 className="mx-auto size-8 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-500">没有符合条件的记录</p>
                  <p className="mt-1 text-xs text-slate-400">可调整查询条件后重新查询</p>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
                <span className="text-xs">每页 {PAGE_SIZE} 条 · 第 {page} / {pages} 页 · 共 {groupedRows.length} 条</span>
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

      {bulkEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={() => !bulkEditLoading && setBulkEditOpen(false)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-exception-bulk-edit-title"
            onSubmit={saveBulkEdit}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg rounded-xl bg-white shadow-2xl"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 id="batch-exception-bulk-edit-title" className="font-bold text-slate-900">批量修改统计字段</h2>
              <p className="mt-1 text-xs text-slate-500">已选择 {selectedSequences.size} 条记录；留空的字段保持原值</p>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className={labelClass}>
                平台
                <input
                  autoFocus
                  value={bulkEditValues.platform}
                  maxLength={100}
                  onChange={(event) => setBulkEditValues((current) => ({ ...current, platform: event.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                客户
                <input
                  value={bulkEditValues.customer}
                  maxLength={100}
                  onChange={(event) => setBulkEditValues((current) => ({ ...current, customer: event.target.value }))}
                  className={inputClass}
                />
              </label>
            </div>
            {bulkEditError && <p role="alert" className="px-5 pb-2 text-sm text-rose-600">{bulkEditError}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" disabled={bulkEditLoading} onClick={() => setBulkEditOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">取消</button>
              <button type="submit" disabled={bulkEditLoading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{bulkEditLoading ? '保存中…' : '保存所选记录'}</button>
            </div>
          </form>
        </div>
      )}

      {mergeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={() => !mergeLoading && setMergeOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-exception-merge-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg rounded-xl bg-white shadow-2xl"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 id="batch-exception-merge-title" className="font-bold text-slate-900">合并统计</h2>
              <p className="mt-1 text-xs text-slate-500">
                已选择 {mergeSelectedRows.length} 条记录，合并后以最小序号 {show(mergeSelectedRows[0]?.sequence)} 展示，统计时算作 1 条
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto px-5 py-3">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="py-1.5 font-medium">序号</th>
                    <th className="py-1.5 font-medium">生产机型</th>
                    <th className="py-1.5 font-medium">生产订单</th>
                    <th className="py-1.5 font-medium">物料SN</th>
                  </tr>
                </thead>
                <tbody>
                  {mergeSelectedRows.map((row) => (
                    <tr key={String(row.sequence ?? row.id)} className="border-t border-slate-100">
                      <td className="py-1.5 font-mono tabular-nums text-slate-500">{show(row.sequence)}</td>
                      <td className="py-1.5 text-slate-700">{show(row.models)}</td>
                      <td className="py-1.5 text-slate-700">{show(row.orderID)}</td>
                      <td className="py-1.5 text-slate-700">{show(row.materialSn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 pb-2 text-xs text-slate-400">其他内容不合并，各行仍可单独编辑；统计图表按锚点行的统计字段计数，可随时解散恢复。</p>
            {mergeError && <p role="alert" className="px-5 pb-2 text-sm text-rose-600">{mergeError}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" disabled={mergeLoading} onClick={() => setMergeOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">取消</button>
              <button type="button" disabled={mergeLoading} onClick={saveMerge} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{mergeLoading ? '合并中…' : '确认合并'}</button>
            </div>
          </div>
        </div>
      )}

      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={() => !editLoading && setEditingRow(null)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-exception-edit-title"
            onSubmit={saveEdit}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xl rounded-xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 id="batch-exception-edit-title" className="font-bold text-slate-900">编辑统计字段</h2>
                <p className="mt-1 text-xs text-slate-400">序号 {show(editingRow.sequence)} · 修改值单独保存，不改动上游原始数据</p>
              </div>
              <button type="button" disabled={editLoading} onClick={() => setEditingRow(null)} aria-label="关闭编辑" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50">
                <X className="size-5" />
              </button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className={labelClass}>
                平台
                <input value={editValues.platform} maxLength={100} onChange={(event) => setEditValues((current) => ({ ...current, platform: event.target.value }))} className={inputClass} />
              </label>
              <label className={labelClass}>
                客户
                <input value={editValues.customer} maxLength={100} onChange={(event) => setEditValues((current) => ({ ...current, customer: event.target.value }))} className={inputClass} />
              </label>
              <label className={labelClass}>
                基地
                <input value={editValues.base} maxLength={100} onChange={(event) => setEditValues((current) => ({ ...current, base: event.target.value }))} className={inputClass} />
              </label>
              <label className={labelClass}>
                批次类别（一级类型）
                <input value={editValues.errTypeFirst} maxLength={100} onChange={(event) => setEditValues((current) => ({ ...current, errTypeFirst: event.target.value }))} className={inputClass} />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                责任单位
                <input value={editValues.causedBy} maxLength={100} onChange={(event) => setEditValues((current) => ({ ...current, causedBy: event.target.value }))} className={inputClass} />
              </label>
            </div>
            {editError && <p role="alert" className="px-5 pb-2 text-sm text-rose-600">{editError}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" disabled={editLoading} onClick={() => setEditingRow(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">取消</button>
              <button type="submit" disabled={editLoading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{editLoading ? '保存中…' : '保存'}</button>
            </div>
          </form>
        </div>
      )}

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
