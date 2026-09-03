import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { X, Bell, CalendarDays, Check, ChevronDown, Loader2, FileText, Search, RefreshCw } from 'lucide-react';
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
import type { RTYFilterParams, CycleStatsConfig } from '../types';

interface AlertConfigModalProps {
  onClose?: () => void;
  modelTargets?: Record<string, number>;
  embedded?: boolean;
  onDetailOpen?: () => void;
  orderScope?: RTYFilterParams['orderScope'];
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

// 预定义一些颜色，用于图表中的不同机型
const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

type CycleFilterOption = {
  value: string;
};

/** 与销售订单看板一致的可搜索多选下拉控件。 */
function CycleMultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
  multiple = true,
}: {
  label: string;
  placeholder: string;
  options: CycleFilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => option.value.toLocaleLowerCase().includes(normalizedQuery))
    : options;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => {
            if (!current) setQuery('');
            return !current;
          });
        }}
        className={`flex h-9 min-w-40 items-center justify-between gap-2 rounded-md border bg-white px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          selected.length > 0 ? 'border-blue-400 text-slate-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'
        }`}
      >
        <span className="truncate">{selected.length > 0 ? `${label} (${selected.length})` : placeholder}</span>
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium text-slate-500">{label}</span>
            <div className="flex items-center gap-3 text-xs">
              {multiple && (
                <button type="button" onClick={() => onChange(filteredOptions.map((option) => option.value))} className="font-medium text-blue-600 hover:text-blue-700">
                  全选
                </button>
              )}
              <button type="button" onClick={() => onChange([])} className="font-medium text-slate-500 hover:text-slate-700">
                清空
              </button>
            </div>
          </div>
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`搜索${label}…`}
                className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {options.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">暂无可选项目</p>
            ) : filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">无匹配“{query.trim()}”的项目</p>
            ) : (
              filteredOptions.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-blue-50/60">
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    checked={selected.includes(option.value)}
                    onChange={() => onChange(multiple ? (selected.includes(option.value) ? selected.filter((value) => value !== option.value) : [...selected, option.value]) : [option.value])}
                    className="size-3.5 rounded border-slate-300 accent-blue-600"
                  />
                  <span className="truncate font-mono text-xs">{option.value}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getPresetRange(months: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);
  return { start: formatMonth(start), end: formatMonth(end) };
}

function CycleTimeRangePicker({
  value,
  start,
  end,
  onPresetChange,
  onCustomRangeChange,
}: {
  value: '6' | '12' | 'custom';
  start: string;
  end: string;
  onPresetChange: (months: '6' | '12') => void;
  onCustomRangeChange: (range: { start: string; end: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const presets = [
    { value: '6' as const, label: '近半年', detail: '最近 6 个月' },
    { value: '12' as const, label: '近一年', detail: '最近 12 个月' },
  ];
  const selectedLabel = value === 'custom'
    ? '自定义范围'
    : presets.find((preset) => preset.value === value)?.label || '选择时间范围';

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-9 min-w-[220px] items-center gap-2 rounded-md border bg-white px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          open ? 'border-blue-400 ring-2 ring-blue-500/15' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-600">
          <CalendarDays className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-slate-800">{selectedLabel}</span>
          <span className="block truncate font-mono text-[10px] text-slate-500">{start || '起始月份'} 至 {end || '结束月份'}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div role="dialog" aria-label="选择统计周期" className="absolute left-0 top-full z-40 mt-1.5 w-[292px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-slate-700">统计周期</p>
            <p className="mt-0.5 text-[11px] text-slate-500">按销售订单计划开始月份统计</p>
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
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
                  className={`relative rounded-md border px-3 py-2.5 text-left transition-colors ${
                    active ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/50'
                  }`}
                >
                  <span className="block text-xs font-semibold">{preset.label}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">{preset.detail}</span>
                  {active && <Check className="absolute right-2 top-2 size-3.5 text-blue-600" aria-label="已选择" />}
                </button>
              );
            })}
          </div>
          <div className={`border-t px-3 py-3 ${value === 'custom' ? 'border-blue-100 bg-blue-50/40' : 'border-slate-100 bg-white'}`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">自定义月份</span>
              {value === 'custom' && <span className="text-[10px] font-medium text-blue-700">当前使用</span>}
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <input
                type="month"
                aria-label="起始月份"
                value={start}
                max={end || undefined}
                onChange={(event) => onCustomRangeChange({ start: event.target.value, end })}
                className="h-8 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              />
              <span className="text-xs text-slate-400">至</span>
              <input
                type="month"
                aria-label="结束月份"
                value={end}
                min={start || undefined}
                onChange={(event) => onCustomRangeChange({ start, end: event.target.value })}
                className="h-8 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function filterCycleData(
  data: RTYData[],
  timeFilter: '6' | '12' | 'custom',
  customStart: string,
  customEnd: string,
  selectedBases: Set<string> | null,
): RTYData[] {
  let result = data;
  if (timeFilter !== 'custom') {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - Number(timeFilter));
    result = result.filter(item => new Date(item.time) >= startDate);
  } else if (customStart && customEnd) {
    result = result.filter(item => {
      const month = item.time.substring(0, 7);
      return month >= customStart && month <= customEnd;
    });
  }

  return selectedBases && selectedBases.size > 0
    ? result.filter(item => selectedBases.has(item.base))
    : result;
}

export default function AlertConfigModal({
  onClose,
  modelTargets = {},
  embedded = false,
  onDetailOpen,
  orderScope = 'normal',
}: AlertConfigModalProps) {
  const { settings, updateSettings } = useSettings();

  // 时间范围快捷键：6 = 近半年, 12 = 近一年, custom = 自定义
  const [timeFilter, setTimeFilter] = useState<'6' | '12' | 'custom'>('12');
  
  // 机型筛选状态
  const [selectedModels, setSelectedModels] = useState<Set<string> | null>(null);
  const [selectedBases, setSelectedBases] = useState<Set<string> | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerList, setCustomerList] = useState<string[]>([]);
  const [filterSaved, setFilterSaved] = useState(false);
  
  // 视图模式：chart = 双图表，heatmap = 热力图
  const [viewMode, setViewMode] = useState<'chart' | 'heatmap'>('heatmap');
  const [showScopeSummaries, setShowScopeSummaries] = useState(true);
  const [customStart, setCustomStart] = useState(() => getPresetRange(12).start);
  const [customEnd, setCustomEnd] = useState(() => getPresetRange(12).end);
  
  // 独立数据拉取（不受主表单影响）
  const [allRawData, setAllRawData] = useState<RTYData[]>([]);
  const [scopeRawData, setScopeRawData] = useState<Record<RTYFilterParams['orderScope'], RTYData[]>>({
    normal: [],
    l6: [],
  });
  const [loading, setLoading] = useState(true);
  const [cycleCacheInfo, setCycleCacheInfo] = useState<{ cachedAt: number | null; fromCache: boolean }>({
    cachedAt: null,
    fromCache: false,
  });

  const fetchAllData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      const customer = selectedCustomer || undefined;
      const scopes: RTYFilterParams['orderScope'][] = Array.from(new Set([orderScope, 'normal', 'l6']));
      const results = await Promise.all(
        scopes.map(scope => rtyApi.getCycleData(scope, customer, { forceRefresh })),
      );
      const dataByScope = new Map(scopes.map((scope, index) => [scope, results[index]]));
      setAllRawData(dataByScope.get(orderScope)?.data || []);
      setScopeRawData({
        normal: dataByScope.get('normal')?.data || [],
        l6: dataByScope.get('l6')?.data || [],
      });
      setCycleCacheInfo({
        cachedAt: results.length > 0 ? Math.min(...results.map(result => result.cachedAt)) : null,
        fromCache: results.length > 0 && results.every(result => result.cached),
      });
    } catch (error) {
      console.error('Failed to fetch cycle stats data', error);
    } finally {
      setLoading(false);
    }
  }, [orderScope, selectedCustomer]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

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

  const handlePresetRange = (months: '6' | '12') => {
    const range = getPresetRange(Number(months));
    setTimeFilter(months);
    setCustomStart(range.start);
    setCustomEnd(range.end);
  };
  
  const filteredData = useMemo(() => {
    return filterCycleData(allRawData, timeFilter, customStart, customEnd, selectedBases);
  }, [allRawData, timeFilter, customStart, customEnd, selectedBases]);

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

  const { trendData, trendModels, tableData, allMonths } = useMemo(() => {
    const map = new Map<string, any>();
    const modelsSet = new Set<string>();

    filteredData.forEach(item => {
      const month = item.time.substring(0, 7);
      if (!map.has(month)) {
        map.set(month, { time: month });
      }
      const current = map.get(month)!;
      
      modelsSet.add(item.productModel);
      
      // 对于每种机型，计算 inputCount 和 (input - defect) / input 的 rty
      if (!current[item.productModel]) {
        current[item.productModel] = { inputCount: 0, defectCount: 0 };
      }
      current[item.productModel].inputCount += item.inputCount;
      current[item.productModel].defectCount += item.defectCount;
    });

    const monthsArray = Array.from(map.keys()).sort();
    const modelsArray = Array.from(modelsSet).sort();

    const chartData = monthsArray.map(month => {
      const item = map.get(month);
      const result: any = { time: month };
      
      modelsArray.forEach(model => {
        if (item[model]) {
          result[`${model}_input`] = item[model].inputCount;
          const rty = ((item[model].inputCount - item[model].defectCount) / item[model].inputCount) * 100;
          result[`${model}_rty`] = Number(rty.toFixed(3));
        } else {
          result[`${model}_input`] = 0;
          // 不要为没有数据的设置 RTY，以免折线图断崖掉到0
        }
      });
      return result;
    });

    // 为表格生成数据
    // 每一行是一个机型，列是月份
    const tblData = modelsArray.map(model => {
      const rowData: any = { model };
      monthsArray.forEach(month => {
        const monthData = map.get(month);
        if (monthData && monthData[model] && monthData[model].inputCount > 0) {
          const rty = ((monthData[model].inputCount - monthData[model].defectCount) / monthData[model].inputCount) * 100;
          const target = modelTargets[model] || 100;
          rowData[month] = {
            text: `${rty.toFixed(3)}% (${monthData[model].defectCount}/${monthData[model].inputCount})`,
            belowTarget: rty < target
          };
        } else {
          rowData[month] = { text: '-' };
        }
      });
      return rowData;
    });

    return { trendData: chartData, trendModels: modelsArray, tableData: tblData, allMonths: monthsArray };
  }, [filteredData]);

  // 根据筛选状态获取实际显示的机型列表
  const displayModels = useMemo(() => {
    if (selectedModels === null) {
      return trendModels;
    }
    return trendModels.filter(m => selectedModels.has(m));
  }, [trendModels, selectedModels]);

  const scopeSummaryRows = useMemo<ScopeSummaryRow[]>(() => (
    (['normal', 'l6'] as const).map(scope => {
      const months: Record<string, ScopeSummaryCell> = {};
      let totalInput = 0;
      let totalDefect = 0;

      filterCycleData(scopeRawData[scope], timeFilter, customStart, customEnd, selectedBases).forEach(item => {
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
  ), [scopeRawData, timeFilter, customStart, customEnd, selectedBases]);

  const heatmapMonths = useMemo(
    () => Array.from(new Set([
      ...allMonths,
      ...scopeSummaryRows.flatMap(row => Object.keys(row.months)),
    ])).sort(),
    [allMonths, scopeSummaryRows],
  );

  // 机型选择/取消的辅助函数
  const handleSaveFilter = async () => {
    try {
      const config: CycleStatsConfig = {
        selectedModels: selectedModels ? Array.from(selectedModels) : [],
      };
      await updateSettings({ cycleStatsConfig: config });
      setFilterSaved(true);
      setTimeout(() => setFilterSaved(false), 2000);
    } catch {
      console.error('Failed to save cycle stats config');
    }
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

  return (
    <div className={embedded ? 'h-full' : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm'}>
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
          {loading && (
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
              <div className="flex items-center gap-3">
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
                    setSelectedModels(values.length === 0 || values.length === modelOptions.length ? null : new Set(values));
                  }}
                />
                <button
                  type="button"
                  onClick={handleSaveFilter}
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  保存筛选
                </button>
                {filterSaved && <span className="text-xs font-medium text-emerald-600">已保存</span>}

                {/* 生产基地筛选：影响整个周期统计口径 */}
                <CycleMultiSelect
                  label="基地"
                  placeholder="选择基地"
                  options={baseOptions}
                  selected={selectedBases === null ? [] : Array.from(selectedBases)}
                  onChange={(values) => {
                    setSelectedBases(values.length === 0 || values.length === baseOptions.length ? null : new Set(values));
                  }}
                />

                <CycleMultiSelect
                  label="客户"
                  placeholder="选择客户"
                  options={customerList.map((value) => ({ value }))}
                  selected={selectedCustomer ? [selectedCustomer] : []}
                  onChange={(values) => setSelectedCustomer(values[0] || '')}
                  multiple={false}
                />
                
                <CycleTimeRangePicker
                  value={timeFilter}
                  start={customStart}
                  end={customEnd}
                  onPresetChange={handlePresetRange}
                  onCustomRangeChange={({ start, end }) => {
                    setCustomStart(start);
                    setCustomEnd(end);
                    setTimeFilter('custom');
                  }}
                />
              </div>
            </div>

            {trendData && trendData.length > 0 && viewMode === 'chart' && (
              <div className="mb-8 border border-slate-200 rounded-sm p-4 bg-white">
                <div className="flex justify-between items-center mb-3">
                  <h5 className="text-xs font-semibold text-slate-700">产量（WMENG）与直通率（RTY）</h5>
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
                      {displayModels.map((model, index) => (
                        <Bar key={`bar-${model}`} dataKey={`${model}_input`} name={`${model} 产量`} yAxisId="input" fill={COLORS[index % COLORS.length]} fillOpacity={0.55} radius={[2, 2, 0, 0]} maxBarSize={24} />
                      ))}
                      {displayModels.map((model, index) => (
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
                                    <div className="leading-tight">
                                      <div>{cell.rtyRate.toFixed(2)}%</div>
                                      <div className="mt-0.5 text-[9px] font-normal opacity-80">{cell.defectCount}/{cell.inputCount}</div>
                                    </div>
                                  ) : '-'}
                                </td>
                              );
                            })}
                            <td className={`px-2 py-2 border-r border-slate-200 text-center text-[10px] ${tone}`}>
                              {totalRty === null ? '-' : (
                                <div className="leading-tight">
                                  <div>{totalRty.toFixed(2)}%</div>
                                  <div className="mt-0.5 text-[9px] font-normal opacity-80">{row.totalInput.toLocaleString()} 台</div>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {tableData
                        .filter(row => displayModels.includes(row.model))
                        .map((row, idx) => {
                        const validMonths = heatmapMonths.filter(m => row[m]?.text && row[m].text !== '-');
                        const avgRty = validMonths.length > 0 
                          ? validMonths.reduce((sum, m) => {
                              const match = row[m]?.text?.match(/^([\d.]+)%/);
                              return sum + (match ? parseFloat(match[1]) : 0);
                            }, 0) / validMonths.length
                          : 0;
                        
                        return (
                          <tr key={idx} className="border-b border-slate-100 last:border-none hover:bg-slate-50/50">
                            <td className="px-3 py-2 border-r border-slate-100 text-[11px] font-medium text-slate-700 whitespace-nowrap sticky left-0 bg-white z-10">
                              {row.model}
                            </td>
                            {heatmapMonths.map(month => {
                              const cell = row[month];
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
                                    <div className="leading-tight">
                                      <div className="font-semibold">{rty?.toFixed(2)}%</div>
                                      <div className="mt-0.5 text-[9px] opacity-75">{cell.text.split('(')[1]?.replace(')', '') || '-'}</div>
                                    </div>
                                  ) : '-'}
                                </td>
                              );
                            })}
                            <td className={`px-2 py-2 border-r border-slate-100 text-center text-[10px] font-semibold bg-slate-100 ${avgRty >= 99.5 ? 'text-green-700' : 'text-red-600'}`}>
                              {avgRty > 0 ? `${avgRty.toFixed(2)}%` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                
                <p className="text-[10px] text-slate-400 mt-2">单元格上方为 RTY，下方为故障数/产量（WMENG）</p>
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
    </div>
  );
}
