import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Search,
  Package,
  Wrench,
  AlertTriangle,
  TrendingUp,
  Download,
  BarChart3,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { lrrApi } from '../api/lrrApi';
import type {
  LRRFilters,
  LRRListResponse,
  LRROptions,
  LRRData,
  LRRDimensionStat,
} from '../types';
import { SortIcon } from '../components/shared/SortIcon';
import LRRFiltersPanel from '../components/lrr/LRRFilters';

type SortField = 'lrrRate' | 'faultCount' | 'totalCount' | 'materialNo';
type FilterMode = 'all' | 'with_assembly' | 'without_assembly';

// 故障率风险分级阈值（%）
const HIGH_RISK_THRESHOLD = 5;

function lrrColor(rate: number | null): { text: string; bar: string } {
  if (rate === null) return { text: 'text-slate-400', bar: '#cbd5e1' };
  if (rate < 2) return { text: 'text-emerald-600', bar: '#10b981' };
  if (rate < HIGH_RISK_THRESHOLD) return { text: 'text-amber-600', bar: '#f59e0b' };
  return { text: 'text-red-600', bar: '#ef4444' };
}

function DimBarChart({ title, data, compact }: { title: string; data: LRRDimensionStat[]; compact?: boolean }) {
  if (!data.length) {
    return (
      <div className={`bg-white rounded-lg border border-slate-200 shadow-sm ${compact ? 'p-2' : 'p-4'}`}>
        <h3 className={`font-semibold text-slate-700 mb-2 ${compact ? 'text-[11px]' : 'text-sm'}`}>{title}</h3>
        <div className={`flex items-center justify-center text-slate-400 text-sm ${compact ? 'h-[80px]' : 'h-[140px]'}`}>暂无数据</div>
      </div>
    );
  }
  const chartData = data.map((d) => ({
    name: d.key.length > 8 ? d.key.slice(0, 8) + '…' : d.key,
    full: d.key,
    rate: d.lrrRate ?? 0,
    faults: d.totalFaults,
    assemblies: d.totalAssemblies,
  }));
  return (
    <div className={`bg-white rounded-lg border border-slate-200 shadow-sm ${compact ? 'p-2' : 'p-4'}`}>
      <h3 className={`font-semibold text-slate-700 mb-2 ${compact ? 'text-[11px]' : 'text-sm'}`}>
        {title}
        <span className="text-[11px] font-normal text-slate-400 ml-1">（按故障率降序）</span>
      </h3>
      <ResponsiveContainer width="100%" height={compact ? Math.max(80, chartData.length * 18) : Math.max(120, chartData.length * 22)}>
        <BarChart data={chartData} layout="vertical" margin={compact ? { left: 4, right: 20, top: 2, bottom: 2 } : { left: 8, right: 28, top: 4, bottom: 4 }}>
          <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: compact ? 9 : 10 }} />
          <YAxis type="category" dataKey="name" width={compact ? 64 : 78} tick={{ fontSize: compact ? 9 : 10 }} />
          <RTooltip
            formatter={(v: any, _n: any, p: any) => [
              `${v}% · 故障 ${p.payload.faults} / 装配 ${p.payload.assemblies}`,
              '故障率',
            ]}
            labelFormatter={(l: any, p: any) => p?.[0]?.payload?.full ?? l}
          />
          <Bar dataKey="rate" radius={[0, 3, 3, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={lrrColor(chartData[i].rate).bar} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function LRRPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [response, setResponse] = useState<LRRListResponse | null>(null);
  const [options, setOptions] = useState<LRROptions>({
    factories: [],
    customers: [],
    productFamilies: [],
    partTypes: [],
    faultTypes: [],
  });
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [filters, setFilters] = useState<LRRFilters>({
    filter: 'all',
    timeGranularity: 'none',
    sortBy: 'lrrRate',
    sortDir: 'desc',
  });
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const total = response?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const data: LRRData[] = response?.items ?? [];

  const load = useCallback(
    async (targetPage: number, f: LRRFilters) => {
      setLoading(true);
      setError(false);
      try {
        const res = await lrrApi.getLRRData(targetPage, pageSize, f);
        setResponse(res);
        setPage(res.page);
      } catch (err) {
        console.error('Failed to fetch LRR data', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    lrrApi
      .getOptions()
      .then((opts) => {
        // 防御：接口可能返回错误体(如 500/404 的 {detail:...})，
        // 缺字段时保留初始空数组，避免下拉组件读取 undefined.map 崩溃
        if (opts && Array.isArray(opts.factories)) {
          setOptions(opts);
        } else {
          console.error('LRR options 返回格式异常，下拉降级为空', opts);
        }
      })
      .catch((e) => console.error('Failed to fetch LRR options', e));
    load(1, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = (patch: Partial<LRRFilters>) => {
    const nf = { ...filters, ...patch };
    setFilters(nf);
    setPage(1);
    load(1, nf);
  };

  const handleFilterMode = (mode: FilterMode) => applyFilters({ filter: mode });

  const handleSort = (field: SortField) => {
    const dir: 'asc' | 'desc' =
      filters.sortBy === field && filters.sortDir === 'desc' ? 'asc' : 'desc';
    applyFilters({ sortBy: field, sortDir: dir });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const details = await lrrApi.getFaultDetails(filters);
      const rows = details.map((d) => ({
        序列号: d.sn,
        销售单: d.saleNo,
        生产工单: d.mfgOrder,
        生产基地: d.factory,
        客户: d.customer,
        机型: d.productFamily,
        生产时间: d.productionTime,
        维修时间: d.repairTime,
        部件PN: d.partPN,
        部件类型: d.partType,
        部件描述: d.partDesc,
        故障类型: d.faultType,
        故障描述: d.faultDesc,
        二次复现: d.fault2ndAppear,
        三次复现: d.fault3rdAppear,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '故障明细');
      XLSX.writeFile(wb, `LRR故障明细_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (e) {
      console.error('导出失败', e);
      alert('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  const sortedData = useMemo(() => {
    const base = search.trim()
      ? data.filter(
          (d) =>
            d.materialNo.toLowerCase().includes(search.trim().toLowerCase()) ||
            (d.materialDesc || '').toLowerCase().includes(search.trim().toLowerCase()),
        )
      : data;
    return base;
  }, [data, search]);

  const summary = response?.summary;

  const kpiCards = [
    {
      label: '物料种类',
      value: (summary?.materialKinds ?? 0).toLocaleString(),
      icon: <Package className="w-4 h-4" />,
      tint: 'text-blue-600 bg-blue-50',
      sub: `有装配 ${summary?.withAssembly ?? 0} · 纯故障 ${summary?.withoutAssembly ?? 0}`,
    },
    {
      label: '总故障件次',
      value: (summary?.totalFaults ?? 0).toLocaleString(),
      icon: <AlertTriangle className="w-4 h-4" />,
      tint: 'text-red-600 bg-red-50',
      sub: `装配件次 ${(summary?.totalAssemblies ?? 0).toLocaleString()}`,
    },
    {
      label: '整体 LRR（加权）',
      value: summary?.overallLrr !== null && summary?.overallLrr !== undefined ? `${summary.overallLrr}%` : '-',
      icon: <TrendingUp className="w-4 h-4" />,
      tint:
        summary?.overallLrr !== null && summary?.overallLrr !== undefined && summary.overallLrr >= HIGH_RISK_THRESHOLD
          ? 'text-red-600 bg-red-50'
          : 'text-emerald-600 bg-emerald-50',
      sub: '故障件次 ÷ 装配件次',
    },
    {
      label: `高风险物料 (≥${HIGH_RISK_THRESHOLD}%)`,
      value: data.filter((d) => d.lrrRate !== null && d.lrrRate >= HIGH_RISK_THRESHOLD).length.toLocaleString(),
      icon: <Wrench className="w-4 h-4" />,
      tint: 'text-amber-600 bg-amber-50',
      sub: '当前页高风险物料数',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 hover:bg-slate-100 rounded-sm transition-colors text-slate-500"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-lg font-semibold text-slate-800">QualiBoard 品质看板 — LRR 工厂阶段部件故障率</h1>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-100 rounded-md p-0.5">
            {(
              [
                { key: 'all', label: '全部物料' },
                { key: 'with_assembly', label: '有装配扫号' },
                { key: 'without_assembly', label: '无装配扫号' },
              ] as { key: FilterMode; label: string }[]
            ).map((opt) => (
              <button
                key={opt.key}
                onClick={() => handleFilterMode(opt.key)}
                className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  filters.filter === opt.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="text-slate-400 font-medium">|</span>
          <span className="text-slate-400 font-medium">快速切换看板:</span>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate('/rty')} className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-sm transition-colors">
              RTY <span className="text-slate-400">整机直通率</span>
            </button>
            <button disabled className="px-2 py-1 bg-blue-600 text-white rounded-sm font-medium">
              LRR <span className="text-blue-100">故障率</span>
            </button>
            <button onClick={() => navigate('/doa')} className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-sm transition-colors">
              DOA <span className="text-slate-400">换件率</span>
            </button>
            <button onClick={() => navigate('/mfr')} className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-sm transition-colors">
              MFR <span className="text-slate-400">月化</span>
            </button>
          </div>
          <button
            onClick={() => setShowStats(true)}
            title="查看 LRR 维度统计图表"
            className="ml-2 px-2.5 py-1 text-xs border border-slate-300 rounded bg-white text-slate-600 hover:bg-slate-50 transition-colors inline-flex items-center gap-1"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            LRR统计
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || !response || summary?.totalFaults === 0}
            title="导出当前筛选条件下的故障明细"
            className="ml-2 px-2.5 py-1 text-xs border border-slate-300 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? '导出中…' : '故障明细导出'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 max-w-[1800px] mx-auto w-full overflow-auto space-y-4">
        {/* KPI 概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpiCards.map((c) => (
            <div key={c.label} className="bg-white rounded-lg border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3">
              <div className={`shrink-0 w-9 h-9 rounded-md flex items-center justify-center ${c.tint}`}>{c.icon}</div>
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 truncate">{c.label}</div>
                <div className="text-xl font-bold text-slate-800 tabular-nums leading-tight">{c.value}</div>
                <div className="text-[11px] text-slate-400 truncate">{c.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 过滤器 */}
          <LRRFiltersPanel
            filters={filters}
            options={options}
            onChange={(patch) => applyFilters(patch)}
            onReset={() => {
            const base: LRRFilters = { filter: 'all', timeGranularity: 'none', sortBy: 'lrrRate', sortDir: 'desc' };
            setFilters(base);
            setPage(1);
            load(1, base);
          }}
        />

        {/* 工具栏: 搜索 + 图例 */}
        <div className="flex items-center justify-between">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索物料编号 / 描述（当前页）"
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 w-72"
            />
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />低 (&lt;2%)</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />中 (2~5%)</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />高 (≥5%)</span>
          </div>
        </div>

        {/* 数据表格 */}
        <div className="flex-1 min-h-0 bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#f8fafc] border-b border-slate-200 text-slate-600 font-semibold text-xs sticky top-0 z-[1]">
                <tr>
                  <th className="px-3 py-2 border-r border-slate-100">物料编号</th>
                  <th className="px-3 py-2 border-r border-slate-100">物料描述</th>
                  <th className="px-3 py-2 border-r border-slate-100 cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort('totalCount')}>
                    <span className="inline-flex items-center gap-1">总装配数量<SortIcon field="totalCount" activeField={filters.sortBy ?? null} direction={filters.sortDir ?? 'desc'} /></span>
                  </th>
                  <th className="px-3 py-2 border-r border-slate-100 cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort('faultCount')}>
                    <span className="inline-flex items-center gap-1">故障数量<SortIcon field="faultCount" activeField={filters.sortBy ?? null} direction={filters.sortDir ?? 'desc'} /></span>
                  </th>
                  <th className="px-3 py-2 border-r border-slate-100 cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort('lrrRate')}>
                    <span className="inline-flex items-center gap-1">故障率 (LRR)<SortIcon field="lrrRate" activeField={filters.sortBy ?? null} direction={filters.sortDir ?? 'desc'} /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-12 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-slate-400">正在加载数据...</span>
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="text-sm text-red-500">⚠ 加载失败</span>
                        <button onClick={() => load(page, filters)} className="px-3 py-1 text-xs border border-slate-300 rounded bg-white text-slate-600 hover:bg-slate-50 transition-colors">
                          点击重试
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : sortedData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                      {search.trim() ? '未找到匹配的物料' : '暂无符合条件的数据'}
                    </td>
                  </tr>
                ) : (
                  sortedData.map((row) => {
                    const color = lrrColor(row.lrrRate);
                    return (
                      <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 font-mono text-slate-700">{row.materialNo}</td>
                        <td className="px-3 py-2 text-slate-600">{row.materialDesc || '-'}</td>
                        <td className="px-3 py-2">
                          {row.totalCount !== null ? row.totalCount : <span className="text-slate-400">无装配数据</span>}
                        </td>
                        <td className="px-3 py-2">
                          {row.faultCount > 0 ? (
                            <span className="text-[#dc2626] font-semibold">{row.faultCount}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.lrrRate !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden shrink-0">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, row.lrrRate * 4)}%`, backgroundColor: color.bar }} />
                              </div>
                              <span className={`font-medium ${color.text}`}>{row.lrrRate}%</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 分页 */}
        {data.length > 0 && !error && (
          <div className="flex items-center justify-between px-2 py-2 bg-white rounded-md border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500">
              {search.trim() ? <>筛选后 {sortedData.length} 种（共 {total} 种物料）</> : <>共 {total} 种物料</>} ，第 {page}/{totalPages} 页
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => { setPage(1); load(1, filters); }} disabled={page === 1} className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">首页</button>
              <button onClick={() => { const p = page - 1; setPage(p); load(p, filters); }} disabled={page <= 1} className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5">
                <ChevronLeft className="w-3 h-3" />上一页
              </button>
              <div className="flex items-center gap-1 mx-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = startPage + i;
                  if (p > totalPages) return null;
                  return (
                    <button key={p} onClick={() => { setPage(p); load(p, filters); }} className={`min-w-[28px] px-1.5 py-1 text-xs rounded transition-colors ${p === page ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {p}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => { const p = page + 1; setPage(p); load(p, filters); }} disabled={page >= totalPages} className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5">
                下一页<ChevronRight className="w-3 h-3" />
              </button>
              <button onClick={() => { setPage(totalPages); load(totalPages, filters); }} disabled={page >= totalPages} className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">末页</button>
            </div>
          </div>
        )}
      </main>

      {/* LRR 维度统计图表弹窗 */}
      {showStats && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowStats(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-5xl w-[95vw] max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-800">LRR 维度统计</h2>
              </div>
              <button
                onClick={() => setShowStats(false)}
                className="p-1 hover:bg-slate-100 rounded transition-colors text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 弹窗主体: 2x2 紧凑图表 */}
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DimBarChart title="按故障类型 LRR" data={response?.byFaultType ?? []} compact />
                <DimBarChart title="按生产基地 LRR" data={response?.byFactory ?? []} compact />
                <DimBarChart title="按机型 LRR" data={response?.byProductFamily ?? []} compact />
                <DimBarChart title="按客户 LRR" data={response?.byCustomer ?? []} compact />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
