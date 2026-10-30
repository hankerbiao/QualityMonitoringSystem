import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Bell, CalendarDays, Check, ChevronDown, Loader2, FileText, Search, RefreshCw, Download, ListFilter } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { RTYData } from '../types';
import { rtyApi } from '../api/rtyApi';
import { useSettings } from '../context/SettingsContext';
import type { RTYFilterParams } from '../types';
import { buildCycleVisualData } from './alert-config/cycleData';
import { appendSourceSheets } from './rty/templateExport';
import CycleDetailModal from './rty/CycleDetailModal';
import { customerIdLabel, NO_CUSTOMER_ID } from '../utils/customerId';
import type { RTYCycleDetailQuery } from '../types/rty';
import { HelpTooltip } from './shared/HelpTooltip';
import { MonthQuickPicker } from './shared/MonthQuickPicker';
import { dateRangePresets } from '../utils/dateRange';
import { CycleMultiSelect, type CycleFilterOption } from './rty/CycleMultiSelect';

interface AlertConfigModalProps {
  onClose?: () => void;
  modelTargets?: Record<string, number>;
  embedded?: boolean;
  onDetailOpen?: () => void;
  orderScope?: RTYFilterParams['orderScope'];
  onOrderScopeChange?: (scope: RTYFilterParams['orderScope']) => void;
  onExcludedOrdersOpen?: () => void;
  selectedOrderTypes?: string[];
  orderTypes?: string[];
  onOrderTypesChange?: (orderTypes: string[]) => void;
  exportContainer?: HTMLElement | null;
}

type ScopeSummaryCell = {
  inputCount: number;
  defectCount: number;
  rtyRate: number;
};

type ScopeSummaryRow = {
  scope: RTYFilterParams['orderScope'];
  label: string;
  months: Record<string, ScopeSummaryCell>;
  totalInput: number;
  totalDefect: number;
};

type CycleDetailSelection = {
  title: string;
  query: RTYCycleDetailQuery;
  inputCount: number;
  defectCount: number;
};

// 预定义一些颜色，用于图表中的不同机型
const EMPTY_ORDER_TYPES: string[] = [];
const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

type CycleTimePreset = '今天' | '昨天' | '近 7 天' | '近 30 天' | '本周' | '上周'
  | '本月' | '上月' | '本季度' | '今年' | '90d' | '6m' | 'custom';
type CycleDateRange = { start: string; end: string };

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthRange(month: string, range: CycleDateRange): CycleDateRange {
  const [year, monthNumber] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  return {
    start: range.start > monthStart ? range.start : monthStart,
    end: range.end < monthEnd ? range.end : monthEnd,
  };
}

function getPresetRange(preset: Exclude<CycleTimePreset, 'custom'>): CycleDateRange {
  const end = new Date();
  const start = new Date(end);
  const shared = dateRangePresets(end).find(item => item.label === preset);
  if (shared) return { start: shared.from, end: shared.to };
  if (preset === '90d') {
    start.setDate(start.getDate() - 89);
  } else if (preset === '6m') {
    const day = start.getDate();
    start.setDate(1);
    start.setMonth(start.getMonth() - 6);
    start.setDate(Math.min(day, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()));
  } else {
    start.setMonth(0, 1);
  }
  return { start: formatDate(start), end: formatDate(end) };
}

function CycleTimeRangePicker({
  value,
  draftStart,
  draftEnd,
  appliedStart,
  appliedEnd,
  onPresetChange,
  onCustomRangeChange,
  onCustomRangeApply,
}: {
  value: CycleTimePreset;
  draftStart: string;
  draftEnd: string;
  appliedStart: string;
  appliedEnd: string;
  onPresetChange: (preset: Exclude<CycleTimePreset, 'custom'>) => void;
  onCustomRangeChange: (range: { start: string; end: string }) => void;
  onCustomRangeApply: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const presets = [
    ...dateRangePresets().map(item => ({ value: item.label as Exclude<CycleTimePreset, 'custom'>, label: item.label })),
    { value: '90d' as const, label: '近90天' },
    { value: '6m' as const, label: '近6个月' },
  ];
  const selectedLabel = value === 'custom'
    ? '自定义日期'
    : presets.find((preset) => preset.value === value)?.label || '选择时间范围';
  const validCustomRange = Boolean(draftStart && draftEnd && draftStart <= draftEnd);
  const hasInvalidOrder = Boolean(draftStart && draftEnd && draftStart > draftEnd);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)
        && !dialogRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const positionDialog = () => {
      const trigger = containerRef.current;
      const dialog = dialogRef.current;
      if (!trigger || !dialog) return;
      const anchor = trigger.getBoundingClientRect();
      const width = Math.min(420, Math.max(0, window.innerWidth - 16));
      const height = Math.min(dialog.offsetHeight, Math.max(0, window.innerHeight - 16));
      dialog.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`;
      dialog.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8))}px`;
    };
    positionDialog();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionDialog);
    if (dialogRef.current) observer?.observe(dialogRef.current);
    window.addEventListener('resize', positionDialog);
    window.addEventListener('scroll', positionDialog, true);
    return () => {
      window.removeEventListener('resize', positionDialog);
      window.removeEventListener('scroll', positionDialog, true);
      observer?.disconnect();
    };
  }, [open]);

  return (
    <div className="relative w-full sm:w-auto" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-md border bg-white px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-w-[220px] ${
          open ? 'border-blue-400 ring-2 ring-blue-500/15' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-600">
          <CalendarDays className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-slate-800">{selectedLabel}</span>
          <span className="block truncate font-mono text-[10px] text-slate-500">{appliedStart} 至 {appliedEnd}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div ref={dialogRef} role="dialog" aria-label="选择统计日期" className="fixed z-[100] max-h-[calc(100vh-1rem)] w-[min(420px,calc(100vw-1rem))] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center gap-1">
              <p className="text-xs font-semibold text-slate-700">统计日期</p>
              <HelpTooltip label="查看周期筛选说明">
                按订单计划开始日期筛选；图表按自然月汇总。
              </HelpTooltip>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 p-3 sm:grid-cols-5" aria-label="日期快捷筛选">
            {presets.map((preset) => {
              const active = value === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    onPresetChange(preset.value);
                    setOpen(false);
                  }}
                  aria-pressed={active}
                  className={`h-8 rounded-md border px-1 text-center text-[11px] font-medium transition-colors ${
                    active ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/50'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="border-t border-slate-100 bg-white px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">自定义日期</span>
              {value === 'custom' && <span className="text-[10px] font-medium text-blue-700">当前使用</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0 text-[10px] font-medium text-slate-500">
                开始日期
                <input
                  type="date"
                  aria-label="开始日期"
                  value={draftStart}
                  onChange={(event) => onCustomRangeChange({ start: event.target.value, end: draftEnd })}
                  className="mt-1 h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
                />
              </label>
              <label className="min-w-0 text-[10px] font-medium text-slate-500">
                结束日期
                <input
                  type="date"
                  aria-label="结束日期"
                  value={draftEnd}
                  onChange={(event) => onCustomRangeChange({ start: draftStart, end: event.target.value })}
                  className="mt-1 h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
                />
              </label>
            </div>
            <MonthQuickPicker
              from={draftStart}
              to={draftEnd}
              onChange={(start, end) => onCustomRangeChange({ start, end })}
              accent="blue"
              defaultExpanded={false}
              className="mt-3 border-t border-slate-100 pt-3"
            />
            <div className="mt-2 flex min-h-8 items-center justify-between gap-2">
              <p className={`text-[10px] ${hasInvalidOrder ? 'text-rose-600' : 'text-slate-400'}`} aria-live="polite">
                {hasInvalidOrder ? '开始日期不能晚于结束日期' : '包含开始日和结束日'}
              </p>
              <button
                type="button"
                disabled={!validCustomRange}
                onClick={() => {
                  onCustomRangeApply();
                  setOpen(false);
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="size-3.5" aria-hidden="true" />
                应用日期
              </button>
            </div>
          </div>
        </div>, document.body
      )}
    </div>
  );
}

function filterCycleData(
  data: RTYData[],
  selectedBases: Set<string> | null,
  selectedModels: Set<string> | null,
): RTYData[] {
  return data.filter(item =>
    (!selectedBases?.size || selectedBases.has(item.base))
    && (selectedModels === null || selectedModels.has(item.productModel)),
  );
}

export default function AlertConfigModal({
  onClose,
  modelTargets = {},
  embedded = false,
  onDetailOpen,
  orderScope = 'normal',
  onOrderScopeChange,
  onExcludedOrdersOpen,
  selectedOrderTypes = EMPTY_ORDER_TYPES,
  orderTypes = [],
  onOrderTypesChange,
  exportContainer,
}: AlertConfigModalProps) {
  const { settings } = useSettings();

  const [timeFilter, setTimeFilter] = useState<CycleTimePreset>('6m');
  
  // 机型筛选状态
  const [selectedModels, setSelectedModels] = useState<Set<string> | null>(null);
  const [selectedBases, setSelectedBases] = useState<Set<string> | null>(null);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [customerList, setCustomerList] = useState<string[]>([]);
  
  // 视图模式：chart = 双图表，heatmap = 热力图
  const [viewMode, setViewMode] = useState<'chart' | 'heatmap'>('heatmap');
  const [showScopeSummaries, setShowScopeSummaries] = useState(true);
  const [appliedRange, setAppliedRange] = useState<CycleDateRange>(() => getPresetRange('6m'));
  const [draftRange, setDraftRange] = useState<CycleDateRange>(appliedRange);
  const [searchRevision, setSearchRevision] = useState(0);
  const forceNextSearch = useRef(false);
  
  // 独立数据拉取（不受主表单影响）
  const [scopeRawData, setScopeRawData] = useState<Record<RTYFilterParams['orderScope'], RTYData[]>>({
    normal: [],
    l6: [],
  });
  const allRawData = scopeRawData[orderScope];
  const latestFetchId = useRef(0);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const queryKey = JSON.stringify([orderScope, selectedOrderTypes.slice().sort(), selectedCustomers.slice().sort(), appliedRange.start, appliedRange.end]);
  const [fetchError, setFetchError] = useState('');
  const [exportError, setExportError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const exportInProgress = useRef(false);
  const [cycleCacheInfo, setCycleCacheInfo] = useState<{ cachedAt: number | null; fromCache: boolean }>({
    cachedAt: null,
    fromCache: false,
  });
  const [cycleDetailSelection, setCycleDetailSelection] = useState<CycleDetailSelection | null>(null);

  const fetchAllData = useCallback(async (forceRefresh = false) => {
    const fetchId = ++latestFetchId.current;
    setLoading(true);
    setFetchError('');
    setExportError('');
    try {
      const results = await Promise.all(
        (['normal', 'l6'] as const).map(scope => rtyApi.getCycleData(scope, selectedCustomers, {
          dateFrom: appliedRange.start,
          dateTo: appliedRange.end,
          forceRefresh,
          ...(selectedOrderTypes.length ? { orderTypes: selectedOrderTypes } : {}),
        })),
      );
      if (fetchId !== latestFetchId.current) return;

      setScopeRawData({ normal: results[0].data, l6: results[1].data });
      setLoadedQueryKey(queryKey);
      setCycleCacheInfo({
        cachedAt: Math.min(...results.map(result => result.cachedAt)),
        fromCache: results.every(result => result.cached),
      });
    } catch (error) {
      if (fetchId === latestFetchId.current) {
        setFetchError(error instanceof Error ? error.message : '周期统计查询失败，请重试');
        setScopeRawData({ normal: [], l6: [] });
        setLoadedQueryKey(null);
        setCycleCacheInfo({ cachedAt: null, fromCache: false });
      }
    } finally {
      if (fetchId === latestFetchId.current) setLoading(false);
    }
  }, [queryKey, selectedOrderTypes, selectedCustomers, appliedRange.start, appliedRange.end]);

  useEffect(() => {
    const forceRefresh = forceNextSearch.current;
    forceNextSearch.current = false;
    void fetchAllData(forceRefresh);
    return () => { latestFetchId.current += 1; };
  }, [fetchAllData, searchRevision]);

  const cacheTimeLabel = cycleCacheInfo.cachedAt
    ? new Date(cycleCacheInfo.cachedAt).toLocaleString('zh-CN', { hour12: false })
    : '';

  // 加载保存的机型筛选配置
  useEffect(() => {
    if (settings.cycleStatsConfig.selectedModels.length > 0) {
      setSelectedModels(new Set(settings.cycleStatsConfig.selectedModels));
    }
  }, [settings.cycleStatsConfig.selectedModels]);

  useEffect(() => {
    const loadCustomers = async () => {
      try {
        setCustomerList(await rtyApi.getCustomers(orderScope));
      } catch (error) {
        console.error('Failed to fetch cycle stats customers', error);
      }
    };
    loadCustomers();
  }, [orderScope]);

  const handlePresetRange = (preset: Exclude<CycleTimePreset, 'custom'>) => {
    const range = getPresetRange(preset);
    setTimeFilter(preset);
    setDraftRange(range);
    setAppliedRange(range);
  };

  const searchCurrentFilters = (customDate = false) => {
    if (!draftRange.start || !draftRange.end || draftRange.start > draftRange.end) return;
    if (customDate || draftRange.start !== appliedRange.start || draftRange.end !== appliedRange.end) {
      setTimeFilter('custom');
    }
    forceNextSearch.current = true;
    setAppliedRange(draftRange);
    setSearchRevision(revision => revision + 1);
  };
  
  const filteredData = useMemo(() => {
    return filterCycleData(allRawData, selectedBases, selectedModels);
  }, [allRawData, selectedBases, selectedModels]);

  const modelOptions = useMemo<CycleFilterOption[]>(
    () => Array.from(new Set(allRawData.map((item) => item.productModel).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value })),
    [allRawData],
  );

  const baseOptions = useMemo<CycleFilterOption[]>(
    () => Array.from(new Set(allRawData.map((item) => item.base).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value })),
    [allRawData],
  );

  const { monthlyData, trendData, trendModels, tableData, allMonths } = useMemo(
    () => buildCycleVisualData(filteredData, modelTargets),
    [filteredData, modelTargets],
  );

  const exportCycleData = async () => {
    if (exportInProgress.current || loading || loadedQueryKey !== queryKey) return;
    exportInProgress.current = true;
    setExporting(true);
    setExportError('');
    try {
      const summaryData = monthlyData
        .map(item => ({
          月份: item.month,
          机型: item.model,
          产量: item.inputCount,
          故障数: item.defectCount,
          直通率: item.rtyRate === null ? '-' : `${item.rtyRate.toFixed(3)}%`,
          目标直通率: `${item.targetRate.toFixed(3)}%`,
          状态: item.rtyRate === null ? '-' : item.rtyRate >= item.targetRate ? '达成' : '未达标',
        }));
      const source = await rtyApi.getCycleExport({
        dateFrom: appliedRange.start,
        dateTo: appliedRange.end,
        orderScope,
        customers: selectedCustomers.length ? selectedCustomers : undefined,
        productModels: selectedModels?.size ? Array.from(selectedModels) : undefined,
        bases: selectedBases?.size ? Array.from(selectedBases) : undefined,
        ...(selectedOrderTypes.length ? { orderTypes: selectedOrderTypes } : {}),
      });
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(summaryData), '趋势汇总');
      appendSourceSheets(book, source);
      XLSX.writeFile(book, `月度生产量及直通率趋势_${appliedRange.start}_${appliedRange.end}.xlsx`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '周期统计导出失败，请重试');
    } finally {
      exportInProgress.current = false;
      setExporting(false);
    }
  };

  const scopeSummaryRows = useMemo<ScopeSummaryRow[]>(() => (
    (['normal', 'l6'] as const).map(scope => {
      const months: Record<string, ScopeSummaryCell> = {};
      let totalInput = 0;
      let totalDefect = 0;

      filterCycleData(scopeRawData[scope], selectedBases, selectedModels).forEach(item => {
        const month = item.time.substring(0, 7);
        const current = months[month] || { inputCount: 0, defectCount: 0, rtyRate: 0 };
        current.inputCount += item.inputCount;
        current.defectCount += item.defectCount;
        current.rtyRate = current.inputCount > 0
          ? ((current.inputCount - current.defectCount) / current.inputCount) * 100
          : 0;
        months[month] = current;
        totalInput += item.inputCount;
        totalDefect += item.defectCount;
      });

      return {
        scope,
        label: scope === 'normal' ? '普通订单汇总' : 'L6 订单汇总',
        months,
        totalInput,
        totalDefect,
      };
    })
  ), [scopeRawData, selectedBases, selectedModels]);

  const heatmapMonths = useMemo(
    () => Array.from(new Set([
      ...allMonths,
      ...scopeSummaryRows.flatMap(row => Object.keys(row.months)),
    ])).sort(),
    [allMonths, scopeSummaryRows],
  );

  const openCycleDetails = ({
    title,
    scope = orderScope,
    month,
    model,
    inputCount,
    defectCount,
  }: {
    title: string;
    scope?: RTYFilterParams['orderScope'];
    month?: string;
    model?: string;
    inputCount: number;
    defectCount: number;
  }) => {
    const range = month ? monthRange(month, appliedRange) : appliedRange;
    const query: RTYCycleDetailQuery = {
      dateFrom: range.start,
      dateTo: range.end,
      orderScope: scope,
      productModels: model
        ? [model]
        : selectedModels?.size
          ? Array.from(selectedModels)
          : undefined,
      bases: selectedBases?.size ? Array.from(selectedBases) : undefined,
      customers: selectedCustomers.length ? selectedCustomers : undefined,
      ...(selectedOrderTypes.length ? { orderTypes: selectedOrderTypes } : {}),
    };
    setCycleDetailSelection({ title, query, inputCount, defectCount });
  };

  // 计算一下总投入和平均RTY等统计数据
  const { totalInput, totalDefect, avgRty, highestRiskModel, bestModel, maxInputMonth } = useMemo(() => {
    let totalIn = 0;
    let totalDef = 0;
    const modelStats = new Map<string, { in: number, def: number }>();
    const monthStats = new Map<string, number>();

    filteredData.forEach(item => {
      totalIn += item.inputCount;
      totalDef += item.defectCount;

      const model = item.productModel;
      if (!modelStats.has(model)) modelStats.set(model, { in: 0, def: 0 });
      modelStats.get(model)!.in += item.inputCount;
      modelStats.get(model)!.def += item.defectCount;

      const month = item.time.substring(0, 7);
      if (!monthStats.has(month)) monthStats.set(month, 0);
      monthStats.set(month, monthStats.get(month)! + item.inputCount);
    });

    const rty = totalIn > 0 ? ((totalIn - totalDef) / totalIn) * 100 : 0;

    let highestRisk = "无";
    let highestDefectRate = -1;
    let best = "无";
    let bestRty = -1;

    modelStats.forEach((stats, model) => {
      if (stats.in > 0) {
        const defectRate = stats.def / stats.in;
        const currentRty = (stats.in - stats.def) / stats.in;
        if (defectRate > highestDefectRate) {
          highestDefectRate = defectRate;
          highestRisk = model;
        }
        if (currentRty > bestRty) {
          bestRty = currentRty;
          best = model;
        }
      }
    });

    let maxInMonth = "无";
    let maxIn = -1;
    monthStats.forEach((val, month) => {
      if (val > maxIn) {
        maxIn = val;
        maxInMonth = month;
      }
    });

    return { 
      totalInput: totalIn, 
      totalDefect: totalDef,
      avgRty: rty.toFixed(2),
      highestRiskModel: highestRisk,
      bestModel: best,
      maxInputMonth: maxInMonth
    };
  }, [filteredData]);

  const exportButton = (
    <button
      type="button"
      onClick={() => void exportCycleData()}
      disabled={loading || exporting || loadedQueryKey !== queryKey || filteredData.length === 0}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-45 sm:px-3"
      title="导出趋势汇总、原始数据及各机型维修物料统计"
      aria-label={exporting ? '导出中...' : '导出'}
    >
      <Download className="size-4" />
      <span className="hidden sm:inline">{exporting ? '导出中...' : '导出'}</span>
    </button>
  );

  return (
    <div className={embedded ? 'h-full' : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm'}>
      {exportContainer && createPortal(exportButton, exportContainer)}
      <div 
        className={`bg-white rounded-md border border-slate-200 w-full overflow-hidden flex flex-col relative ${embedded ? 'h-full' : 'max-w-6xl shadow-xl'}`}
        onClick={(e) => e.stopPropagation()}
        style={embedded ? undefined : { maxHeight: '90vh' }}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-[#f8fafc]">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-700" />
            <h3 className="text-base font-semibold text-slate-800">周期统计</h3>
          </div>
          <div className="flex items-center gap-4">
            {!exportContainer && exportButton}
            {embedded && onDetailOpen && (
              <button
                onClick={onDetailOpen}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                详情
              </button>
            )}
            {!embedded && (
              <button
                onClick={() => onClose?.()}
                className="p-1 rounded-sm hover:bg-slate-200 text-slate-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto bg-white flex flex-col gap-6 relative">
          {fetchError && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>{fetchError}</span>
              <button type="button" onClick={() => void fetchAllData(true)} className="shrink-0 underline">重新查询</button>
            </div>
          )}
          {exportError && <p role="alert" className="text-sm text-red-700">{exportError}</p>}
          {(loading || (!fetchError && loadedQueryKey !== queryKey)) && (
            <div className="absolute inset-0 z-20 bg-white/70 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
          )}
          <div className="flex flex-col gap-4">
            <h4 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2">当前周期统计概览</h4>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">周期内累计投入</p>
                <p className="text-lg font-bold text-slate-800">{totalInput.toLocaleString()} <span className="text-xs font-normal text-slate-500">台</span></p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">综合平均直通率</p>
                <p className="text-lg font-bold text-slate-800">{avgRty}%</p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">周期内总故障数</p>
                <p className="text-lg font-bold text-slate-800">{totalDefect.toLocaleString()} <span className="text-xs font-normal text-slate-500">件</span></p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">产量最高月份</p>
                <p className="text-lg font-bold text-slate-800">{maxInputMonth}</p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">高风险机型 (故障率最高)</p>
                <p className="text-sm font-bold text-slate-800 mt-1 truncate" title={highestRiskModel}>{highestRiskModel}</p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">最佳表现机型 (RTY最高)</p>
                <p className="text-sm font-bold text-slate-800 mt-1 truncate" title={bestModel}>{bestModel}</p>
              </div>
            </div>
          </div>

          {/* 下方：趋势图表及表格 */}
          <div className="w-full border-t border-slate-100 pt-6">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h4 className="text-sm font-semibold text-slate-800">月度生产量及直通率趋势 (按机型)</h4>
                {/* 视图切换 */}
                <div className="flex border border-slate-200 rounded-sm overflow-hidden">
                  <button
                    onClick={() => setViewMode('heatmap')}
                    className={`px-3 py-1 text-xs ${viewMode === 'heatmap' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    热力图
                  </button>
                  <button
                    onClick={() => setViewMode('chart')}
                    className={`px-3 py-1 text-xs border-l border-slate-200 ${viewMode === 'chart' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    趋势图
                  </button>
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={showScopeSummaries}
                    onChange={(event) => setShowScopeSummaries(event.target.checked)}
                    className="size-3.5 rounded border-slate-300 accent-blue-600"
                  />
                  显示订单汇总
                </label>
                {onOrderScopeChange && (
                  <div className="inline-flex h-7 overflow-hidden rounded-sm border border-slate-300 text-[11px] font-medium" aria-label="订单范围">
                    <button
                      type="button"
                      onClick={() => onOrderScopeChange('normal')}
                      aria-pressed={orderScope === 'normal'}
                      className={`px-2.5 transition-colors ${orderScope === 'normal' ? 'bg-blue-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      普通订单
                    </button>
                    <button
                      type="button"
                      onClick={() => onOrderScopeChange('l6')}
                      aria-pressed={orderScope === 'l6'}
                      className={`border-l border-slate-300 px-2.5 transition-colors ${orderScope === 'l6' ? 'bg-blue-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      L6 订单
                    </button>
                  </div>
                )}
                {onExcludedOrdersOpen && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onExcludedOrdersOpen}
                      className="inline-flex h-7 items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 px-2 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-100"
                    >
                      <ListFilter className="size-3.5" />
                      筛选订单
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-400" title={cacheTimeLabel ? `周期统计${cycleCacheInfo.fromCache ? '缓存' : '数据'}时间：${cacheTimeLabel}` : '周期统计数据尚未加载'}>
                  <span>{cacheTimeLabel ? `${cycleCacheInfo.fromCache ? '缓存于' : '更新于'} ${cacheTimeLabel}` : '数据尚未加载'}</span>
                  <button
                    type="button"
                    onClick={() => fetchAllData(true)}
                    disabled={loading}
                    aria-label="刷新周期统计数据"
                    title="刷新周期统计数据"
                    className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                {/* 机型筛选 */}
                <CycleMultiSelect
                  label="机型"
                  placeholder="选择机型"
                  options={modelOptions}
                  selected={selectedModels === null ? [] : Array.from(selectedModels)}
                  onChange={(values) => {
                    setSelectedModels(values.length === 0 ? null : new Set(values));
                  }}
                />
                {/* 生产基地筛选：影响整个周期统计口径 */}
                <CycleMultiSelect
                  label="基地"
                  placeholder="选择基地"
                  options={baseOptions}
                  selected={selectedBases === null ? [] : Array.from(selectedBases)}
                  onChange={(values) => {
                    setSelectedBases(values.length === 0 ? null : new Set(values));
                  }}
                />

                <CycleMultiSelect
                  label="客户"
                  placeholder="选择客户"
                  options={[
                    { value: NO_CUSTOMER_ID, label: customerIdLabel(NO_CUSTOMER_ID) },
                    ...customerList.filter(value => value !== NO_CUSTOMER_ID).map(value => ({ value })),
                  ]}
                  selected={selectedCustomers}
                  onChange={setSelectedCustomers}
                />
                {onOrderTypesChange && (
                  <CycleMultiSelect label="订单类型" placeholder="全部订单类型" selected={selectedOrderTypes}
                    options={[...new Set(['PP01', ...orderTypes, ...selectedOrderTypes])].sort().map(value => ({ value }))}
                    onChange={onOrderTypesChange} />
                )}
                
                <CycleTimeRangePicker
                  value={timeFilter}
                  draftStart={draftRange.start}
                  draftEnd={draftRange.end}
                  appliedStart={appliedRange.start}
                  appliedEnd={appliedRange.end}
                  onPresetChange={handlePresetRange}
                  onCustomRangeChange={setDraftRange}
                  onCustomRangeApply={() => searchCurrentFilters(true)}
                />
                <button
                  type="button"
                  onClick={() => searchCurrentFilters()}
                  disabled={loading || !draftRange.start || !draftRange.end || draftRange.start > draftRange.end}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Search className="size-4" aria-hidden="true" />
                  搜索
                </button>
              </div>
            </div>

            {trendData && trendData.length > 0 && viewMode === 'chart' && (
              <div className="mb-8 border border-slate-200 rounded-sm p-4 bg-white">
                <div className="flex justify-between items-center mb-3">
                  <h5 className="text-xs font-semibold text-slate-700">订单数量（GAMNG）与直通率（RTY）</h5>
                  <span className="text-[10px] text-slate-400">柱：台 · 线：%</span>
                </div>
                <div className="h-72 text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} dy={8} />
                      <YAxis yAxisId="input" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} />
                      <YAxis
                        yAxisId="rty"
                        orientation="right"
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                        formatter={(value, name) => name?.toString().includes('RTY') ? `${Number(value).toFixed(3)}%` : Number(value).toLocaleString()}
                      />
                      <Legend wrapperStyle={{ paddingTop: '8px', fontSize: '10px' }} />
                      {trendModels.map((model, index) => (
                        <Bar key={`bar-${model}`} dataKey={`${model}_input`} name={`${model} 产量`} yAxisId="input" fill={COLORS[index % COLORS.length]} fillOpacity={0.55} radius={[2, 2, 0, 0]} maxBarSize={24} />
                      ))}
                      {trendModels.map((model, index) => (
                        <Line key={`line-${model}`} type="monotone" dataKey={`${model}_rty`} name={`${model} RTY`} yAxisId="rty" stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={{ r: 3, strokeWidth: 1 }} activeDot={{ r: 5 }} connectNulls={true} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            
            {/* 热力图模式 */}
            {heatmapMonths.length > 0 && viewMode === 'heatmap' && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <h5 className="text-xs font-semibold text-slate-700">RTY 热力图</h5>
                    <div className="flex items-center gap-4 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span>
                        达成
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm bg-red-500 inline-block"></span>
                        未达成
                      </span>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-sm">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#f8fafc] border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 border-r border-slate-100 text-[11px] font-semibold text-slate-600 whitespace-nowrap sticky left-0 bg-[#f8fafc] z-10">机型</th>
                        {heatmapMonths.map(month => (
                          <th key={month} className="px-2 py-2 border-r border-slate-100 text-[10px] text-slate-500 text-center min-w-[60px]">{month}</th>
                        ))}
                        <th className="px-2 py-2 border-r border-slate-100 text-[10px] font-semibold text-slate-500 text-center bg-slate-100">产量汇总</th>
                      </tr>
                    </thead>
                    <tbody>
                      {showScopeSummaries && scopeSummaryRows.map(row => {
                        const totalRty = row.totalInput > 0
                          ? ((row.totalInput - row.totalDefect) / row.totalInput) * 100
                          : null;
                        const tone = row.scope === 'normal'
                          ? 'bg-sky-50 text-sky-800'
                          : 'bg-violet-50 text-violet-800';

                        return (
                          <tr key={row.scope} className={`border-b border-slate-200 font-semibold ${tone}`}>
                            <td className={`px-3 py-2 border-r border-slate-200 text-[11px] whitespace-nowrap sticky left-0 z-10 ${tone}`}>
                              {row.label}
                            </td>
                            {heatmapMonths.map(month => {
                              const cell = row.months[month];
                              return (
                                <td key={month} className={`px-2 py-2 border-r border-slate-200 text-center text-[10px] ${tone}`}>
                                  {cell ? (
                                    <button
                                      type="button"
                                      onClick={() => openCycleDetails({
                                        title: `${row.label} · ${month}`,
                                        scope: row.scope,
                                        month,
                                        inputCount: cell.inputCount,
                                        defectCount: cell.defectCount,
                                      })}
                                      className="w-full rounded-sm px-1 py-1 leading-tight transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"
                                      title="点击查看该月订单与维修明细"
                                    >
                                      <span className="block">{cell.rtyRate.toFixed(2)}%</span>
                                      <span className="mt-0.5 block text-[9px] font-normal opacity-80">{cell.defectCount}/{cell.inputCount}</span>
                                    </button>
                                  ) : '-'}
                                </td>
                              );
                            })}
                            <td className={`px-2 py-2 border-r border-slate-200 text-center text-[10px] ${tone}`}>
                              {totalRty === null ? '-' : (
                                <button
                                  type="button"
                                  onClick={() => openCycleDetails({
                                    title: `${row.label} · 周期合计`,
                                    scope: row.scope,
                                    inputCount: row.totalInput,
                                    defectCount: row.totalDefect,
                                  })}
                                  className="w-full rounded-sm px-1 py-1 leading-tight transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"
                                  title="点击查看所选周期的订单与维修明细"
                                >
                                  <span className="block">{totalRty.toFixed(2)}%</span>
                                  <span className="mt-0.5 block text-[9px] font-normal opacity-80">{row.totalInput.toLocaleString()} 台</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {tableData
                        .map((row, idx) => {
                        const totalRty = row.inputCount > 0
                          ? ((row.inputCount - row.defectCount) / row.inputCount) * 100
                          : null;
                        
                        return (
                          <tr key={idx} className="border-b border-slate-100 last:border-none hover:bg-slate-50/50">
                            <td className="px-3 py-2 border-r border-slate-100 text-[11px] font-medium text-slate-700 whitespace-nowrap sticky left-0 bg-white z-10">
                              {row.model}
                            </td>
                            {heatmapMonths.map(month => {
                              const cell = row.cells[month];
                              const hasData = cell?.text && cell?.text !== '-';
                              const rtyMatch = cell?.text?.match(/^([\d.]+)%/);
                              const rty = rtyMatch ? parseFloat(rtyMatch[1]) : null;
                              
                              let bgClass = 'bg-slate-50';
                              let textClass = 'text-slate-400';
                              let fontClass = '';
                              
                              if (hasData && rty !== null) {
                                if (cell.belowTarget) {
                                  bgClass = 'bg-red-100';
                                  textClass = 'text-red-700';
                                  fontClass = 'font-semibold';
                                } else {
                                  bgClass = 'bg-green-100';
                                  textClass = 'text-green-700';
                                }
                              }
                              
                              return (
                                <td 
                                  key={month} 
                                  className={`px-2 py-2 border-r border-slate-100 text-center text-[10px] ${bgClass} ${textClass} ${fontClass}`}
                                  title={cell?.text || ''}
                                >
                                  {hasData ? (
                                    <button
                                      type="button"
                                      onClick={() => openCycleDetails({
                                        title: `${row.model} · ${month}`,
                                        month,
                                        model: row.model,
                                        inputCount: cell.inputCount ?? 0,
                                        defectCount: cell.defectCount ?? 0,
                                      })}
                                      className="w-full rounded-sm px-1 py-1 leading-tight transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"
                                      title={`点击查看 ${row.model} ${month} 明细`}
                                    >
                                      <span className="block font-semibold">{rty?.toFixed(2)}%</span>
                                      <span className="mt-0.5 block text-[9px] opacity-75">{cell.text.split('(')[1]?.replace(')', '') || '-'}</span>
                                    </button>
                                  ) : '-'}
                                </td>
                              );
                            })}
                            <td className={`px-2 py-2 border-r border-slate-100 text-center text-[10px] font-semibold bg-slate-100 ${totalRty === null ? 'text-slate-400' : totalRty >= row.targetRate ? 'text-green-700' : 'text-red-600'}`}>
                              {totalRty === null ? '-' : (
                                <button
                                  type="button"
                                  onClick={() => openCycleDetails({
                                    title: `${row.model} · 周期合计`,
                                    model: row.model,
                                    inputCount: row.inputCount,
                                    defectCount: row.defectCount,
                                  })}
                                  className="w-full rounded-sm px-1 py-1 leading-tight transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"
                                  title={`点击查看 ${row.model} 所选周期明细`}
                                >
                                  <span className="block">{totalRty.toFixed(2)}%</span>
                                  <span className="mt-0.5 block text-[9px] font-normal opacity-75">{row.defectCount.toLocaleString()}/{row.inputCount.toLocaleString()}</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                
              </div>
            )}
          </div>
        </div>
        
        {!embedded && (
          <div className="px-5 py-3 border-t border-slate-200 bg-[#f8fafc] flex justify-end mt-auto">
            <button
              onClick={() => onClose?.()}
              className="px-6 py-1.5 bg-[#1e40af] hover:bg-[#1e3a8a] text-white rounded-sm text-sm font-medium transition-colors shadow-sm"
            >
              关闭
            </button>
          </div>
        )}
      </div>
      {cycleDetailSelection && (
        <CycleDetailModal
          title={cycleDetailSelection.title}
          query={cycleDetailSelection.query}
          inputCount={cycleDetailSelection.inputCount}
          defectCount={cycleDetailSelection.defectCount}
          onClose={() => setCycleDetailSelection(null)}
        />
      )}
    </div>
  );
}
