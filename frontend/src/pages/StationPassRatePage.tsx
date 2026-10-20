import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  CircleHelp,
  Download,
  Factory,
  FileSearch,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { rtyApi } from '../api/rtyApi';
import type { StationGroupBy, StationPassDetail, StationPassQuery, StationPassRate } from '../types';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { MonthQuickPicker } from '../components/shared/MonthQuickPicker';
import { StationPassFindings, StationQueryLaunch } from '../components/station/StationPassWorkspace';
import { buildStationPassWorkbook } from '../components/station/exportData';
import { combinedStationPassRate, rowMatchesBand, summarizeStationRates, type StationRateRow } from '../utils/stationPassRate';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';

const dimensionLabels: Record<StationGroupBy, string> = {
  salesOrder: '销售订单号',
  productionOrder: '生产订单号',
  productModel: '机型',
};

const STATION_DESCRIPTIONS: Record<string, string> = {
  OP10: '装配',
  OP150: '过程质量检验',
  OP170: '硬盘安装与外观检验',
  OP180: '过程质量检验',
  OP190: '硬盘及假盘架安装',
  OP200: '老化初检',
  OP205: '初检前测',
  OP210: '老化测试',
  OP215: '综检后测',
  OP220: '老化综检',
  OP221: '冲洗',
  OP222: '排液烘干充氮',
  OP230: 'CCC安规测试',
  OP240: '成品质量检验',
  OP250: '维修',
  OP300: '外箱贴标',
  OP310: '附件装箱',
  OP320: '包装',
};

function stationDescription(stationCode: string, fallback = ''): string {
  return STATION_DESCRIPTIONS[stationCode] || fallback || '工序';
}

type DetailState = { rate: StationRateRow; type: 'input' | 'defect' };
type StationQueryState = {
  dateFrom: string;
  dateTo: string;
  serialNumber: string;
  productModels: string[];
  customers: string[];
  bases: string[];
  groupBy: StationGroupBy;
  orderScope: 'normal' | 'l6';
  overseas: boolean;
};
type StationRowFocus = 'all' | 'watch' | 'alert';

function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: formatDateInput(from), to: formatDateInput(to) };
}

function formatRate(inputCount: number, defectCount: number) {
  return inputCount > 0 ? `${(((inputCount - defectCount) / inputCount) * 100).toFixed(2)}%` : '-';
}

function formatUpdatedAt(value: Date | null) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
    : null;
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  if (seconds === 60) return `${minutes + 1} 分 0 秒`;
  return `${minutes} 分 ${seconds} 秒`;
}

function exportCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

type StationFilterOption = { value: string; count?: number };

function StationFilterMultiSelect({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: string[];
  options: StationFilterOption[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const filteredOptions = options.filter((option) => option.value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectedLabel = selected.length === 0
    ? `全部${label}`
    : selected.length === 1
      ? selected[0]
      : `${selected[0]} 等 ${selected.length} 项`;

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <div ref={containerRef} className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-slate-600 xl:max-w-48">
      <span>{label}（多选）</span>
      <div className="relative">
        <button
          type="button"
          aria-label={`${label}（多选）`}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={selected.length ? selected.join('、') : undefined}
          onClick={() => {
            setOpen((current) => !current);
            setSearch('');
          }}
          className={`flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-white px-2.5 text-sm font-normal outline-none transition-colors focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 ${
            selected.length ? 'border-cyan-300 text-slate-800' : 'border-slate-300 text-slate-500'
          }`}
        >
          <span className="truncate">{selectedLabel}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
            {selected.length > 0 && <span>{selected.length}</span>}
            <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {open && (
          <div role="dialog" aria-label={`选择${label}`} className="absolute left-0 top-full z-50 mt-1 w-full min-w-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-500">已选 {selected.length} 项</span>
              <div className="flex items-center gap-3 text-xs">
                <button type="button" onClick={() => onChange(filteredOptions.map((option) => option.value))} className="font-medium text-cyan-700 hover:text-cyan-800">全选</button>
                <button type="button" onClick={() => onChange([])} className="font-medium text-slate-500 hover:text-slate-700">清空</button>
              </div>
            </div>
            <div className="border-b border-slate-100 p-2">
              <input
                type="search"
                aria-label={`搜索${label}`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`搜索${label}`}
                className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white"
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {options.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-slate-400">暂无可选项目</p>
              ) : filteredOptions.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-slate-400">没有匹配项</p>
              ) : filteredOptions.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-cyan-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    onChange={() => onChange(
                      selected.includes(option.value)
                        ? selected.filter((value) => value !== option.value)
                        : [...selected, option.value],
                    )}
                    className="size-3.5 rounded border-slate-300 accent-cyan-600"
                  />
                  <span className="min-w-0 flex-1 truncate">{option.value}</span>
                  {option.count !== undefined && <span className="font-mono text-[10px] text-slate-400">{option.count}</span>}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function rawFaultFields(raw: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(raw || {})
    .filter(([key]) => !['ZDATE_WX', 'ZTIME', 'repairAt', 'repair_time'].includes(key))
    .map(([key, value]) => [`原始_${key}`, exportCell(value)]));
}

function rateTone(rate: number) {
  if (rate >= 98) return 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 focus-visible:ring-emerald-500';
  if (rate >= 95) return 'bg-amber-50 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-500';
  return 'bg-red-50 text-red-800 hover:bg-red-100 focus-visible:ring-red-500';
}

function CalculationHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="calculation-help-title" className="w-full max-w-2xl overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2"><CircleHelp className="size-4 text-cyan-700" /><h2 id="calculation-help-title" className="text-sm font-semibold text-slate-900">工位直通率计算口径</h2></div>
          <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="关闭" aria-label="关闭说明"><X className="size-4" /></button>
        </div>
        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4 text-sm leading-6 text-slate-600">
          <section>
            <h3 className="font-semibold text-slate-800">单工站直通率</h3>
            <p>分母 = 该工站时间范围内过站的唯一机器 SN；维修扣减 = 匹配同一工站的唯一维修 SN；分子 = 分母 - 维修扣减，最低按 0 计。</p>
            <p className="mt-1">直通率 = 分子 ÷ 分母 × 100%。</p>
          </section>
          <section>
            <h3 className="mb-2 font-semibold text-slate-800">字段对照</h3>
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600"><tr><th className="border-b border-slate-200 px-3 py-2">用途</th><th className="border-b border-slate-200 px-3 py-2">数据字段</th><th className="border-b border-slate-200 px-3 py-2">中文含义</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  <tr><td className="px-3 py-2">过站 SN / 分母</td><td className="px-3 py-2 font-mono text-slate-800">station_records_sap.PCODE</td><td className="px-3 py-2">机器序列号，按 SN 去重</td></tr>
                  <tr><td className="px-3 py-2">过站日期筛选</td><td className="px-3 py-2 font-mono text-slate-800">station_records_sap.GSTRS</td><td className="px-3 py-2">计划开始时间</td></tr>
                  <tr><td className="px-3 py-2">工站匹配</td><td className="px-3 py-2 font-mono text-slate-800">station_records_sap.SPEC / OPERATION</td><td className="px-3 py-2">过站工站编码</td></tr>
                  <tr><td className="px-3 py-2">维修 SN / 扣减</td><td className="px-3 py-2 font-mono text-slate-800">repair_records_sap.PCODE</td><td className="px-3 py-2">维修记录对应的机器序列号，按 SN 去重</td></tr>
                  <tr><td className="px-3 py-2">维修记录日期筛选</td><td className="px-3 py-2 font-mono text-slate-800">repair_records_sap.GSTRS</td><td className="px-3 py-2">计划开始时间，当前统计使用该字段</td></tr>
                  <tr><td className="px-3 py-2">维修工站匹配</td><td className="px-3 py-2 font-mono text-slate-800">repair_records_sap.ZNGGZ</td><td className="px-3 py-2">维修不良工站</td></tr>
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h3 className="font-semibold text-slate-800">RTY 汇总列</h3>
            <p>RTY 汇总列使用订单的 <span className="font-mono text-slate-800">WMENG</span>（订单产量）作为分母，订单计划开始日期使用 <span className="font-mono text-slate-800">GSTRS</span>；它与各工站过站 SN 数不是同一统计口径。</p>
            <p className="mt-1">故障数为所选订单关联的全部故障 SN 去重数量，不限制维修日期或维修年份，与 RTY 页周期统计保持一致。</p>
            <p className="mt-1">跨月或跨工厂地点时，按 RTY 页相同的分组计算后汇总。</p>
          </section>
          <section>
            <h3 className="font-semibold text-slate-800">组合工站直通率</h3>
            <p>将已选择工站的单站直通率转为小数后相乘，再转回百分比。它表示选定工站组合表现，不是 RTY 汇总值。</p>
          </section>
        </div>
      </section>
    </div>
  );
}

export default function StationPassRatePage() {
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const { user } = useAuth();
  const canConfigureStations = user?.role === 'admin';
  const [initialDateRange] = useState(defaultDateRange);
  const [dateFrom, setDateFrom] = useState(initialDateRange.from);
  const [dateTo, setDateTo] = useState(initialDateRange.to);
  const [serialNumber, setSerialNumber] = useState('');
  const [productModel, setProductModel] = useState('');
  const [base, setBase] = useState('');
  const [selectedProductModels, setSelectedProductModels] = useState<string[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [selectedBases, setSelectedBases] = useState<string[]>([]);
  const [productModels, setProductModels] = useState<{ model: string; count: number }[]>([]);
  const [customers, setCustomers] = useState<string[]>([]);
  const [bases, setBases] = useState<{ base: string; count: number }[]>([]);
  const [groupBy, setGroupBy] = useState<StationGroupBy>('productModel');
  const [orderScope, setOrderScope] = useState<'normal' | 'l6'>('normal');
  const [overseas, setOverseas] = useState(false);
  const [rows, setRows] = useState<StationPassRate[]>([]);
  const [selectedStations, setSelectedStations] = useState<string[]>([]);
  const [onlyAvailableStations, setOnlyAvailableStations] = useState(true);
  const [stationConfigOpen, setStationConfigOpen] = useState(false);
  const [calculationHelpOpen, setCalculationHelpOpen] = useState(false);
  const [stationConfigSaving, setStationConfigSaving] = useState(false);
  const [stationConfigError, setStationConfigError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [appliedQuery, setAppliedQuery] = useState<StationPassQuery | null>(null);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<Date | null>(null);
  const [queryDurationMs, setQueryDurationMs] = useState<number | null>(null);
  const [loadingElapsedMs, setLoadingElapsedMs] = useState(0);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [detailRows, setDetailRows] = useState<StationPassDetail[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailExporting, setDetailExporting] = useState<'input' | 'defect' | null>(null);
  const [detailExportError, setDetailExportError] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [rowFocus, setRowFocus] = useState<StationRowFocus>('all');
  const loadRequestId = useRef(0);
  const queryStartedAt = useRef<number | null>(null);
  const queryRef = useRef<StationQueryState>({
    dateFrom: initialDateRange.from,
    dateTo: initialDateRange.to,
    serialNumber: '',
    productModels: [],
    customers: [],
    bases: [],
    groupBy: 'productModel',
    orderScope: 'normal',
    overseas: false,
  });
  const detailRequestId = useRef(0);
  const detailDialogRef = useRef<HTMLDivElement>(null);
  const detailCloseButtonRef = useRef<HTMLButtonElement>(null);

  const invalidateResults = () => {
    loadRequestId.current += 1;
    setLoading(false);
    setRows([]);
    setSelectedStations([]);
    setStationConfigOpen(false);
    setHasSearched(false);
    setAppliedQuery(null);
    setDataUpdatedAt(null);
    setQueryDurationMs(null);
    queryStartedAt.current = null;
    setRowFocus('all');
    setError('');
  };

  const load = useCallback(async (snapshot?: StationQueryState) => {
    const next = snapshot ?? queryRef.current;
    const requestId = ++loadRequestId.current;
    if (next.dateFrom > next.dateTo) {
      setError('开始日期不能晚于结束日期');
      setRows([]);
      return;
    }

    const query: StationPassQuery = {
      dateFrom: next.dateFrom,
      dateTo: next.dateTo,
      serialNumber: next.serialNumber.trim() || undefined,
      productModels: next.productModels,
      customers: next.customers,
      bases: next.bases,
      groupBy: next.groupBy,
      orderScope: next.orderScope,
      overseas: next.overseas,
    };
    const startedAt = performance.now();
    queryStartedAt.current = startedAt;
    setLoadingElapsedMs(0);
    setLoading(true);
    setError('');
    try {
      const response = await rtyApi.getStationPassRates(query);
      if (requestId !== loadRequestId.current) return;
      setQueryDurationMs(performance.now() - startedAt);
      setRows(response);
      const stations = Array.from(new Set(response.map((row) => row.stationCode))).sort((left, right) => left.localeCompare(right, 'zh-CN'));
      const savedStations = settings.stationPassRateConfig.selectedStations;
      setSelectedStations(settings.stationPassRateConfig.configured
        ? savedStations.filter((station) => stations.includes(station))
        : stations);
      setAppliedQuery(query);
      setDataUpdatedAt(new Date());
      setHasSearched(true);
    } catch (err) {
      console.error('Failed to fetch station pass rates', err);
      if (requestId !== loadRequestId.current) return;
      setQueryDurationMs(performance.now() - startedAt);
      setRows([]);
      setAppliedQuery(null);
      setDataUpdatedAt(null);
      setHasSearched(true);
      setError(err instanceof Error && err.message ? err.message : '工位过站数据加载失败，请重新查询重试');
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [settings.stationPassRateConfig]);

  useEffect(() => {
    if (!loading || queryStartedAt.current == null) return;
    const timer = window.setInterval(() => {
      if (queryStartedAt.current != null) setLoadingElapsedMs(performance.now() - queryStartedAt.current);
    }, 200);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    const loadFilterOptions = async () => {
      setOptionsLoading(true);
      try {
        const options = await rtyApi.getFilterOptions(orderScope);
        if (cancelled) return;
        setProductModels(options.productModels);
        setCustomers(options.customers);
        setBases(options.bases);
      } catch (err) {
        console.error('Failed to fetch station filter options', err);
        if (!cancelled) {
          setProductModels([]);
          setCustomers([]);
          setBases([]);
        }
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    };
    void loadFilterOptions();
    return () => {
      cancelled = true;
    };
  }, [orderScope]);

  const closeDetail = useCallback(() => {
    detailRequestId.current += 1;
    setDetailLoading(false);
    setDetail(null);
  }, []);

  useEffect(() => {
    if (!detail) return;

    detailCloseButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDetail();
        return;
      }
      if (event.key !== 'Tab' || !detailDialogRef.current) return;

      const focusable = Array.from(detailDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (!detailDialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeDetail, detail]);

  const reset = () => {
    setDateFrom(initialDateRange.from);
    setDateTo(initialDateRange.to);
    setSerialNumber('');
    setProductModel('');
    setBase('');
    setSelectedProductModels([]);
    setSelectedCustomers([]);
    setSelectedBases([]);
    setGroupBy('productModel');
    setOrderScope('normal');
    setOverseas(false);
    queryRef.current = {
      ...queryRef.current,
      dateFrom: initialDateRange.from,
      dateTo: initialDateRange.to,
      serialNumber: '',
      productModels: [],
      customers: [],
      bases: [],
      groupBy: 'productModel',
      orderScope: 'normal',
      overseas: false,
    };
    invalidateResults();
  };

  const matrix = useMemo(() => {
    const stations = Array.from(new Set(rows.map((row) => row.stationCode))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const groups = new Map<string, Map<string, StationPassRate>>();
    rows.forEach((row) => {
      const stationRows = groups.get(row.dimensionValue) || new Map<string, StationPassRate>();
      stationRows.set(row.stationCode, row);
      groups.set(row.dimensionValue, stationRows);
    });

    return {
      stations,
      rows: Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right, 'zh-CN')).map(([dimensionValue, stationRows]) => {
        const stationValues = Array.from(stationRows.values());
        const total = {
          // 汇总计数由后端按 RTY 订单口径计算，不能从工位计数相加推算。
          inputCount: stationValues[0].totalInputCount,
          defectCount: stationValues[0].totalDefectCount,
        };
        return { dimensionValue, stationRows, total };
      }),
    };
  }, [rows]);

  const openDetail = async (rate: StationRateRow, type: 'input' | 'defect' = 'input') => {
    if (!appliedQuery) return;
    const requestId = ++detailRequestId.current;
    setDetail({ rate, type });
    setDetailRows([]);
    setDetailLoading(true);
    setDetailExportError('');
    try {
      const response = await rtyApi.getStationPassDetails(rate.stationCode, { ...appliedQuery, dimensionValue: rate.dimensionValue }, type);
      if (requestId !== detailRequestId.current) return;
      setDetailRows(response);
    } catch (err) {
      console.error('Failed to fetch station details', err);
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false);
    }
  };

  const exportDetailRows = async (type: 'input' | 'defect') => {
    if (!detail || !appliedQuery || detailExporting) return;
    setDetailExporting(type);
    setDetailExportError('');
    try {
      const rows = await rtyApi.getStationPassDetails(
        detail.rate.stationCode,
        { ...appliedQuery, dimensionValue: detail.rate.dimensionValue },
        type,
      );
      const data = rows.map((item) => ({
        '机器 SN': item.sn,
        过站日期: item.passDate || '-',
        故障代码: item.defectCode || '-',
        故障描述: item.description || '-',
        ...(type === 'defect' ? {
          维修人: item.repairPerson || '-',
        } : {}),
        ...rawFaultFields(item.raw),
      }));
      const sheet = XLSX.utils.json_to_sheet(data);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, type === 'input' ? '过站SN' : '维修SN');
      XLSX.writeFile(book, `${type === 'input' ? '过站SN' : '维修SN'}_${detail.rate.stationCode}_${appliedQuery.dateFrom}_${appliedQuery.dateTo}.xlsx`);
    } catch (err) {
      console.error('Failed to export station details', err);
      setDetailExportError(err instanceof Error && err.message ? err.message : '明细导出失败，请重试');
    } finally {
      setDetailExporting(null);
    }
  };

  const exportRows = async () => {
    if (!appliedQuery || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const data = matrix.rows.map((row) => ({
        [dimensionLabels[appliedQuery.groupBy]]: row.dimensionValue,
        Total: formatRate(row.total.inputCount, row.total.defectCount),
        产量: row.total.inputCount,
        故障数: row.total.defectCount,
        工站直通率: (() => {
          const rate = combinedStationPassRate(row.stationRows, selectedStations, onlyAvailableStations);
          return rate === null ? '-' : `${rate.toFixed(2)}%`;
        })(),
        ...Object.fromEntries(matrix.stations.map((station) => [station, row.stationRows.has(station) ? `${row.stationRows.get(station)!.passRate.toFixed(2)}%` : '-'])),
      }));
      const source = await rtyApi.getStationPassExport(appliedQuery);
      const book = buildStationPassWorkbook(XLSX.utils.json_to_sheet(data), source);
      XLSX.writeFile(book, `工位直通率_${appliedQuery.groupBy}_${appliedQuery.dateFrom}_${appliedQuery.dateTo}.xlsx`);
    } catch (err) {
      console.error('Failed to export station pass rates', err);
      setExportError(err instanceof Error && err.message ? err.message : '导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  const updateField = <K extends keyof StationQueryState>(key: K, setter: (value: StationQueryState[K]) => void, value: StationQueryState[K]) => {
    setter(value);
    queryRef.current = { ...queryRef.current, [key]: value };
    invalidateResults();
  };
  const updateDateRange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    queryRef.current = { ...queryRef.current, dateFrom: from, dateTo: to };
    invalidateResults();
  };
  const applyAndLoad = (overrides: Partial<StationQueryState>) => {
    const next = { ...queryRef.current, ...overrides };
    queryRef.current = next;
    if (overrides.dateFrom !== undefined) setDateFrom(overrides.dateFrom);
    if (overrides.dateTo !== undefined) setDateTo(overrides.dateTo);
    if (overrides.serialNumber !== undefined) setSerialNumber(overrides.serialNumber);
    if (overrides.productModels !== undefined) {
      setSelectedProductModels(overrides.productModels);
      setProductModel(overrides.productModels.join(', '));
    }
    if (overrides.customers !== undefined) setSelectedCustomers(overrides.customers);
    if (overrides.bases !== undefined) {
      setSelectedBases(overrides.bases);
      setBase(overrides.bases.join(', '));
    }
    if (overrides.groupBy !== undefined) setGroupBy(overrides.groupBy);
    if (overrides.orderScope !== undefined) setOrderScope(overrides.orderScope);
    if (overrides.overseas !== undefined) setOverseas(overrides.overseas);
    void load(next);
  };

  const dimensionLabel = dimensionLabels[groupBy];
  const colSpan = matrix.stations.length + 3;
  const updatedAt = formatUpdatedAt(dataUpdatedAt);
  const findings = useMemo(() => summarizeStationRates(rows), [rows]);
  const tableRows = useMemo(() => (
    rowFocus === 'all' ? matrix.rows : matrix.rows.filter((row) => rowMatchesBand(row.stationRows.values(), rowFocus))
  ), [matrix.rows, rowFocus]);
  const toggleStation = (station: string) => {
    setSelectedStations((current) => current.includes(station)
      ? current.filter((value) => value !== station)
      : [...current, station]);
  };
  const closeStationConfig = () => setStationConfigOpen(false);

  const saveStationConfig = async () => {
    if (!canConfigureStations) return;
    setStationConfigSaving(true);
    setStationConfigError('');
    try {
      await updateSettings({ stationPassRateConfig: { selectedStations } });
      setStationConfigOpen(false);
    } catch (err) {
      console.error('Failed to save station pass rate config', err);
      setStationConfigError('工站配置保存失败，请重试');
    } finally {
      setStationConfigSaving(false);
    }
  };

  useEffect(() => {
    if (!stationConfigOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeStationConfig();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [stationConfigOpen]);

  useEffect(() => {
    if (!calculationHelpOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCalculationHelpOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [calculationHelpOpen]);

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
        <div className="mx-auto flex min-h-15 max-w-[1600px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <button type="button" onClick={() => navigate('/')} className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600" title="返回首页" aria-label="返回首页"><ArrowLeft className="size-4" /></button>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-cyan-600 text-white"><Factory className="size-4" /></div>
            <div className="flex min-w-0 items-center gap-1.5"><div className="min-w-0"><h1 className="truncate text-base font-semibold text-slate-900">工位过站直通率</h1><p className="hidden text-xs text-slate-500 sm:block">过站记录与维修工位匹配分析</p></div><button type="button" onClick={() => setCalculationHelpOpen(true)} className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-cyan-50 hover:text-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600" title="查看计算口径" aria-label="查看工位直通率计算口径"><CircleHelp className="size-4" /></button></div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <DashboardSwitcher />
            <button type="button" onClick={() => void exportRows()} disabled={loading || exporting || !hasSearched || matrix.rows.length === 0} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-45 sm:px-3" title="导出透视表、销售订单及维修故障明记录" aria-label="导出透视表、销售订单及维修故障明记录"><Download className="size-4" /><span className="hidden sm:inline">{exporting ? '导出中' : '导出'}</span></button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
        {exportError && <p role="alert" className="text-sm text-red-600">{exportError}</p>}
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-2"><div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-cyan-700"><SlidersHorizontal className="size-4" /></div><h2 className="text-sm font-semibold text-slate-800">{dimensionLabel}工位直通率</h2></div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {updatedAt && <span>更新于 {updatedAt}</span>}
              {loading ? <span className="font-mono text-cyan-700">已查询 {formatDuration(loadingElapsedMs)}</span> : queryDurationMs != null && <span className="font-mono">查询耗时 {formatDuration(queryDurationMs)}</span>}
              {hasSearched && !loading && !error && <span className="font-medium text-slate-700">{rowFocus === 'all' ? matrix.rows.length.toLocaleString('zh-CN') : `${tableRows.length.toLocaleString('zh-CN')}/${matrix.rows.length.toLocaleString('zh-CN')}`} 个{dimensionLabel}</span>}
            </div>
          </div>

          <form className={`flex flex-wrap items-end gap-x-2 gap-y-3 bg-slate-50/80 px-4 py-3 ${(loading || error || hasSearched) ? 'border-b border-slate-100' : ''}`} onSubmit={(event) => { event.preventDefault(); void load(); }}>
            <div className="min-w-[280px] flex-1 xl:max-w-sm">
              <label className="mb-1 flex items-center text-xs font-medium text-slate-600">
                计划开始日期（GSTRS）
                <button type="button" className="ml-1 inline-flex size-4 items-center justify-center text-slate-400 hover:text-slate-600" title="按销售订单计划开始日期 GSTRS 统计" aria-label="计划开始日期说明">?</button>
              </label>
              <div className="flex items-center gap-1">
                <input type="date" value={dateFrom} onChange={(event) => updateField('dateFrom', setDateFrom, event.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
                <span className="text-xs text-slate-400">-</span>
                <input type="date" value={dateTo} onChange={(event) => updateField('dateTo', setDateTo, event.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
              </div>
              <MonthQuickPicker from={dateFrom} to={dateTo} onChange={updateDateRange} accent="cyan" defaultExpanded={false} className="mt-2" />
            </div>
              <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-slate-600 xl:max-w-44">统计维度<select value={groupBy} onChange={(event) => updateField('groupBy', setGroupBy, event.target.value as StationGroupBy)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"><option value="salesOrder">销售订单号</option><option value="productionOrder">生产订单号</option><option value="productModel">机型</option></select></label>
              <div className="flex min-w-36 flex-col gap-1 text-xs font-medium text-slate-600"><span>订单范围</span><div className="inline-flex h-9 overflow-hidden rounded-md border border-slate-300 bg-white"><button type="button" onClick={() => updateField('orderScope', setOrderScope, 'normal')} className={`px-3 text-xs ${orderScope === 'normal' ? 'bg-cyan-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>普通订单</button><button type="button" onClick={() => updateField('orderScope', setOrderScope, 'l6')} className={`border-l border-slate-300 px-3 text-xs ${orderScope === 'l6' ? 'bg-cyan-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>L6 订单</button></div></div>
              <label className="inline-flex h-9 min-w-24 items-center gap-2 self-end rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700"><input type="checkbox" checked={overseas} onChange={(event) => updateField('overseas', setOverseas, event.target.checked)} className="size-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />海外</label>
            <StationFilterMultiSelect
              label="客户 ID"
              selected={selectedCustomers}
              options={customers.map((value) => ({ value }))}
              onChange={(values) => {
                setSelectedCustomers(values);
                updateField('customers', () => {}, values);
              }}
            />
            <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-slate-600 xl:max-w-44">服务器 SN<input value={serialNumber} onChange={(event) => updateField('serialNumber', setSerialNumber, event.target.value)} placeholder="精确输入 SN" className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label>
            <StationFilterMultiSelect
              label="机型"
              selected={selectedProductModels}
              options={productModels.map((item) => ({ value: item.model, count: item.count }))}
              onChange={(values) => {
                setProductModel(values.length === 1 ? values[0] : '');
                updateField('productModels', setSelectedProductModels, values);
              }}
            />
            <StationFilterMultiSelect
              label="工厂地点"
              selected={selectedBases}
              options={bases.map((item) => ({ value: item.base, count: item.count }))}
              onChange={(values) => {
                setBase(values.length === 1 ? values[0] : '');
                updateField('bases', setSelectedBases, values);
              }}
            />
            <div className="flex items-center gap-1.5"><button type="button" onClick={reset} className="inline-flex size-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-100" title="重置条件" aria-label="重置条件"><RotateCcw className="size-4" /></button><button type="submit" disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-cyan-600 px-3 text-sm font-medium text-white transition-colors hover:bg-cyan-700 disabled:cursor-wait disabled:opacity-60">{loading ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}{loading ? '正在计算' : '查询'}</button></div>
          </form>

          {!loading && !error && (!hasSearched || matrix.rows.length === 0) && (
            <StationQueryLaunch
              orderScope={orderScope}
              models={productModels}
              bases={bases}
              loading={optionsLoading}
              selectedModel={productModel}
              selectedBase={base}
              dateFrom={dateFrom}
              dateTo={dateTo}
              stations={settings.stationPassRateConfig.selectedStations}
              stationsConfigured={settings.stationPassRateConfig.configured}
              onPickModel={(model) => applyAndLoad({ productModels: [model] })}
              onPickBase={(nextBase) => applyAndLoad({ bases: [nextBase] })}
              onPickRange={(from, to) => applyAndLoad({ dateFrom: from, dateTo: to })}
            />
          )}

          {hasSearched && !loading && !error && matrix.rows.length > 0 && (
            <StationPassFindings
              summary={findings}
              focus={rowFocus}
              onFocusChange={setRowFocus}
              onOpen={(rate) => void openDetail(rate)}
            />
          )}

          {hasSearched && matrix.stations.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3"><div><div className="text-xs font-semibold text-slate-700">组合工站</div><div className="mt-0.5 text-xs text-slate-400">已选 {selectedStations.length} / {matrix.stations.length} 个工站</div></div><div className="flex items-center gap-3"><label className="inline-flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={onlyAvailableStations} onChange={(event) => setOnlyAvailableStations(event.target.checked)} className="size-4 rounded border-slate-300 text-cyan-600" />仅计算当前有值工站</label>{canConfigureStations && <button type="button" onClick={() => setStationConfigOpen(true)} aria-haspopup="dialog" aria-expanded={stationConfigOpen} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"><Settings2 className="size-4" />配置工站</button>}</div></div>}

          {(loading || error || hasSearched) && <div className="overflow-auto">
            <table className="w-full min-w-max border-separate border-spacing-0 text-left">
          <thead className="text-xs font-semibold text-slate-600"><tr><th className="sticky left-0 top-0 z-20 min-w-52 border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left shadow-[1px_0_0_0_rgb(226_232_240)]">{dimensionLabel}</th><th className="sticky left-52 top-0 z-20 min-w-30 border-b border-r border-slate-200 bg-slate-100 px-3 py-3 text-center shadow-[1px_0_0_0_rgb(226_232_240)]">RTY直通率</th><th className="sticky left-[20.5rem] top-0 z-20 min-w-32 border-b border-r border-slate-200 bg-cyan-50 px-3 py-3 text-center"><span className="inline-flex items-center justify-center gap-1">组合工站直通率<button type="button" onClick={() => setCalculationHelpOpen(true)} className="inline-flex size-5 items-center justify-center rounded-full text-cyan-700 transition-colors hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600" title="查看组合工站直通率计算方法" aria-label="查看组合工站直通率计算方法"><CircleHelp className="size-3.5" /></button></span></th>{matrix.stations.map((station) => { const sourceName = rows.find((row) => row.stationCode === station)?.stationName; const description = stationDescription(station, sourceName !== station ? sourceName : ''); return <th key={station} className="sticky top-0 z-10 min-w-32 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-center font-mono" title={description}><span className="block text-slate-700">{station}</span><span className="mt-0.5 block max-w-28 truncate font-sans text-[10px] font-medium text-slate-400">{description}</span></th>; })}</tr></thead>
              <tbody className="text-xs">
                {loading ? <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-slate-500"><span className="inline-flex items-center gap-2"><RefreshCw className="size-4 animate-spin text-cyan-600" />正在计算工位过站量与维修记录匹配关系... {formatDuration(loadingElapsedMs)}</span></td></tr> : error ? <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-red-600">{error}</td></tr> : matrix.rows.length === 0 ? <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-slate-500">当前条件下暂无工位过站数据</td></tr> : tableRows.length === 0 ? <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-slate-500">没有落在该区间的记录</td></tr> : tableRows.map((row) => { const combinedRate = combinedStationPassRate(row.stationRows, selectedStations, onlyAvailableStations); return <tr key={row.dimensionValue} className="group"><th className="sticky left-0 z-10 max-w-52 truncate border-b border-r border-slate-200 bg-white px-4 py-3.5 text-left font-mono font-semibold text-slate-800 shadow-[1px_0_0_0_rgb(226_232_240)] group-hover:bg-slate-50" title={row.dimensionValue}>{row.dimensionValue}</th><td className="sticky left-52 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-center shadow-[1px_0_0_0_rgb(226_232_240)] group-hover:bg-slate-100/70"><div className="font-mono text-sm font-semibold text-slate-800">{formatRate(row.total.inputCount, row.total.defectCount)}</div><div className="mt-0.5 font-mono text-[11px] text-slate-500">{row.total.defectCount}/{row.total.inputCount}</div></td><td className="sticky left-[20.5rem] z-10 border-b border-r border-slate-200 bg-cyan-50 px-3 py-2 text-center shadow-[1px_0_0_0_rgb(226_232_240)] group-hover:bg-cyan-100/70"><div className="font-mono text-sm font-semibold text-cyan-900">{combinedRate === null ? '-' : `${combinedRate.toFixed(2)}%`}</div><div className="mt-0.5 text-[11px] text-cyan-700">{selectedStations.length ? `${selectedStations.length} 个工站` : '未选择工站'}</div></td>{matrix.stations.map((station) => { const rate = row.stationRows.get(station); return !rate ? <td key={station} className="border-b border-r border-slate-100 bg-slate-50/40 px-3 py-2 text-center text-slate-300">-</td> : <td key={station} className="border-b border-r border-slate-100 p-1.5 text-center"><button type="button" onClick={() => void openDetail(rate)} className={`flex min-h-13 w-full flex-col items-center justify-center rounded-sm px-2 py-1.5 font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${rateTone(rate.passRate)}`} title={`过站量 ${rate.inputCount}，维修记录 ${rate.defectCount} 条；点击查看明细`}><span className="text-sm font-semibold">{rate.passRate.toFixed(2)}%</span><span className="mt-0.5 text-[11px] font-medium opacity-75">{rate.defectCount}/{rate.inputCount}</span></button></td>; })}</tr>; })}
              </tbody>
            </table>
          </div>}
        </section>
      </main>

      {calculationHelpOpen && <CalculationHelpDialog onClose={() => setCalculationHelpOpen(false)} />}

      {stationConfigOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={closeStationConfig}><div role="dialog" aria-modal="true" aria-labelledby="station-config-title" className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-md bg-white shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 id="station-config-title" className="text-sm font-semibold text-slate-900">配置组合工站</h2><p className="mt-0.5 text-xs text-slate-500">已选择的工站用于计算工站直通率，完成后会长期保存</p></div><button type="button" onClick={closeStationConfig} disabled={stationConfigSaving} aria-label="关闭" title="关闭" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X className="size-4" /></button></div><div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><span className="text-xs text-slate-500">已选 {selectedStations.length} / {matrix.stations.length} 个</span><div className="flex items-center gap-3"><button type="button" onClick={() => setSelectedStations(matrix.stations)} disabled={stationConfigSaving} className="text-xs font-medium text-cyan-700 hover:text-cyan-800 disabled:opacity-40">全选</button><button type="button" onClick={() => setSelectedStations([])} disabled={!selectedStations.length || stationConfigSaving} className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">清空</button></div></div><div className="grid grid-cols-2 gap-x-6 gap-y-2 overflow-y-auto px-5 py-4 sm:grid-cols-3">{matrix.stations.map((station) => <label key={station} className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={selectedStations.includes(station)} disabled={stationConfigSaving} onChange={() => toggleStation(station)} className="size-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" /><span className="font-mono">{station}</span></label>)}</div><div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">{stationConfigError ? <span className="text-xs text-red-600">{stationConfigError}</span> : <span className="text-xs text-slate-400">当前选择将在后续查询中自动恢复</span>}<button type="button" onClick={() => void saveStationConfig()} disabled={stationConfigSaving} className="inline-flex h-9 items-center rounded-md bg-cyan-600 px-4 text-sm font-medium text-white hover:bg-cyan-700 disabled:cursor-wait disabled:opacity-60">{stationConfigSaving ? '保存中...' : '完成'}</button></div></div></div>}

      {detail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={closeDetail}><div ref={detailDialogRef} role="dialog" aria-modal="true" aria-labelledby="station-detail-title" className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-md bg-white shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div className="flex items-center gap-2"><FileSearch className="size-4 text-cyan-600" /><div><h2 id="station-detail-title" className="text-sm font-semibold text-slate-900">{detail.rate.dimensionValue} · {detail.rate.stationCode}</h2><p className="mt-0.5 text-xs text-slate-500">{detail.rate.stationName || '未命名工位'} · {appliedQuery?.dateFrom} 至 {appliedQuery?.dateTo}</p></div></div><button ref={detailCloseButtonRef} type="button" onClick={closeDetail} aria-label="关闭" title="关闭" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X className="size-4" /></button></div><div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2"><button type="button" onClick={() => void openDetail(detail.rate, 'input')} className={`rounded-md px-3 py-1.5 text-xs font-medium ${detail.type === 'input' ? 'bg-cyan-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>过站 SN</button><button type="button" onClick={() => void openDetail(detail.rate, 'defect')} className={`rounded-md px-3 py-1.5 text-xs font-medium ${detail.type === 'defect' ? 'bg-cyan-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>维修 SN</button><span className="mx-1 hidden h-5 border-l border-slate-200 sm:block" /><button type="button" onClick={() => void exportDetailRows('input')} disabled={detailExporting !== null} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50" title="导出全部过站 SN"><Download className="size-3.5" />{detailExporting === 'input' ? '导出中...' : '导出过站 SN'}</button><button type="button" onClick={() => void exportDetailRows('defect')} disabled={detailExporting !== null} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50" title="导出全部维修 SN"><Download className="size-3.5" />{detailExporting === 'defect' ? '导出中...' : '导出维修 SN'}</button></div><div className="overflow-auto p-4">{detailExportError && <p role="alert" className="mb-3 text-xs text-red-600">{detailExportError}</p>}{detailLoading ? <div className="py-12 text-center text-sm text-slate-500">正在加载明细...</div> : detailRows.length === 0 ? <div className="py-12 text-center text-sm text-slate-500">暂无明细数据</div> : <table className="w-full min-w-[820px] text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-600"><tr><th className="px-3 py-2">机器 SN</th><th className="px-3 py-2">过站日期</th><th className="px-3 py-2">故障代码</th><th className="px-3 py-2">故障描述</th>{detail.type === 'defect' && <th className="px-3 py-2">维修人</th>}</tr></thead><tbody className="divide-y divide-slate-100">{detailRows.map((item) => <tr key={item.id} className="hover:bg-slate-50"><td className="px-3 py-2 font-mono text-slate-700">{item.sn}</td><td className="px-3 py-2 text-slate-600">{item.passDate || '-'}</td><td className="px-3 py-2 text-red-700">{item.defectCode || '-'}</td><td className="max-w-[260px] px-3 py-2 text-slate-600">{item.description || '-'}</td>{detail.type === 'defect' && <td className="px-3 py-2 text-slate-600">{item.repairPerson || '-'}</td>}</tr>)}</tbody></table>}</div><div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">共 {detailRows.length.toLocaleString('zh-CN')} 条记录</div></div></div>}
    </div>
  );
}
