import { useState, useEffect, useMemo } from 'react';
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
  BarChart3,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  PieChart,
  Pie,
} from 'recharts';
import { lrrApi } from '../api/lrrApi';
import type { LRRData } from '../types';
import { SortIcon } from '../components/shared/SortIcon';

type SortField = 'totalCount' | 'faultCount' | 'lrrRate';
type FilterMode = 'all' | 'with_assembly' | 'without_assembly';

// 故障率风险分级阈值（%）
const HIGH_RISK_THRESHOLD = 5;

function lrrColor(rate: number | null): { text: string; bar: string } {
  if (rate === null) return { text: 'text-slate-400', bar: '#cbd5e1' };
  if (rate < 2) return { text: 'text-emerald-600', bar: '#10b981' };
  if (rate < HIGH_RISK_THRESHOLD) return { text: 'text-amber-600', bar: '#f59e0b' };
  return { text: 'text-red-600', bar: '#ef4444' };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function LRRPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [data, setData] = useState<LRRData[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<FilterMode>('all');
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 全量数据（用于概览统计与图表，limit=500 上限内）
  const [overview, setOverview] = useState<LRRData[]>([]);
  const [search, setSearch] = useState('');
  const [chartsOpen, setChartsOpen] = useState(false);

  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const fetchOverview = async (currentFilter: FilterMode) => {
    try {
      const res = await lrrApi.getLRRData(1, 500, currentFilter);
      setOverview(res.items);
    } catch (e) {
      console.error('Failed to fetch LRR overview', e);
      setOverview([]);
    }
  };

  const fetchData = async (targetPage = page, currentFilter = filter) => {
    setLoading(true);
    setError(false);
    try {
      const result = await lrrApi.getLRRData(targetPage, pageSize, currentFilter);
      setData(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (err) {
      console.error('Failed to fetch LRR data', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(1, filter);
    fetchOverview(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const handleFilterChange = (newFilter: FilterMode) => {
    if (newFilter !== filter) {
      setFilter(newFilter);
      setPage(1);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleExport = () => {
    const exportData = sortedData.map((row) => ({
      '物料编号': row.materialNo,
      '物料描述': row.materialDesc || '-',
      '总装配数量': row.totalCount !== null ? row.totalCount : '无装配数据',
      '故障数量': row.faultCount,
      '故障率(%)': row.lrrRate !== null ? row.lrrRate : '-',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'LRR故障率');
    XLSX.writeFile(wb, `LRR故障率数据导出_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const sortedData = useMemo(() => {
    const base = search.trim()
      ? data.filter(
          (d) =>
            d.materialNo.toLowerCase().includes(search.trim().toLowerCase()) ||
            (d.materialDesc || '').toLowerCase().includes(search.trim().toLowerCase()),
        )
      : data;
    if (!sortField) return base;
    return [...base].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortField, sortDirection, search]);

  // ===== 概览统计 =====
  const stats = useMemo(() => {
    const total = overview.length;
    const withAsm = overview.filter((d) => d.totalCount !== null).length;
    const withoutAsm = total - withAsm;
    const totalFaults = overview.reduce((s, d) => s + d.faultCount, 0);
    const totalAsm = overview.reduce((s, d) => s + (d.totalCount ?? 0), 0);
    const avgLrr = totalAsm > 0 ? round2((totalFaults / totalAsm) * 100) : null;
    const highRisk = overview.filter(
      (d) => d.lrrRate !== null && d.lrrRate >= HIGH_RISK_THRESHOLD,
    ).length;
    return { total, withAsm, withoutAsm, totalFaults, totalAsm, avgLrr, highRisk };
  }, [overview]);

  // ===== 图表数据 =====
  const topRiskData = useMemo(
    () =>
      overview
        .filter((d) => d.lrrRate !== null)
        .sort((a, b) => (b.lrrRate ?? 0) - (a.lrrRate ?? 0))
        .slice(0, 10)
        .map((d) => ({ name: d.materialNo, rate: d.lrrRate ?? 0, color: lrrColor(d.lrrRate).bar })),
    [overview],
  );

  const pieData = [
    { name: '有装配扫号', value: stats.withAsm, color: '#3b82f6' },
    { name: '无装配扫号', value: stats.withoutAsm, color: '#f59e0b' },
  ];

  const kpiCards = [
    {
      label: '物料总数',
      value: stats.total.toLocaleString(),
      icon: <Package className="w-4 h-4" />,
      tint: 'text-blue-600 bg-blue-50',
      sub: `有装配 ${stats.withAsm} · 无装配 ${stats.withoutAsm}`,
    },
    {
      label: '总故障件次',
      value: stats.totalFaults.toLocaleString(),
      icon: <AlertTriangle className="w-4 h-4" />,
      tint: 'text-red-600 bg-red-50',
      sub: `涉及 ${overview.filter((d) => d.faultCount > 0).length} 种物料`,
    },
    {
      label: '整体 LRR（加权）',
      value: stats.avgLrr !== null ? `${stats.avgLrr}%` : '-',
      icon: <TrendingUp className="w-4 h-4" />,
      tint: stats.avgLrr !== null && stats.avgLrr >= HIGH_RISK_THRESHOLD ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50',
      sub: `基于 ${stats.totalAsm.toLocaleString()} 台装配量`,
    },
    {
      label: `高风险物料 (≥${HIGH_RISK_THRESHOLD}%)`,
      value: stats.highRisk.toLocaleString(),
      icon: <Wrench className="w-4 h-4" />,
      tint: stats.highRisk > 0 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-100',
      sub: '故障率超阈值，需重点跟进',
    },
  ];

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
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
          {/* 筛选开关 */}
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
                onClick={() => handleFilterChange(opt.key)}
                className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  filter === opt.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
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
            onClick={handleExport}
            disabled={data.length === 0}
            title="导出当前页数据"
            className="ml-2 px-2.5 py-1 text-xs border border-slate-300 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            导出 Excel
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 max-w-[1800px] mx-auto w-full overflow-auto">
        {/* KPI 概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {kpiCards.map((c) => (
            <div key={c.label} className="bg-white rounded-lg border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3">
              <div className={`shrink-0 w-9 h-9 rounded-md flex items-center justify-center ${c.tint}`}>
                {c.icon}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 truncate">{c.label}</div>
                <div className="text-xl font-bold text-slate-800 tabular-nums leading-tight">{c.value}</div>
                <div className="text-[11px] text-slate-400 truncate">{c.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 工具栏：搜索 + 统计分析入口 */}
        <div className="flex items-center justify-between mb-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索物料编号 / 描述"
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 w-72"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setChartsOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-colors"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              统计分析
            </button>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />低 (&lt;2%)</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />中 (2~5%)</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />高 (≥5%)</span>
            </div>
          </div>
        </div>

        {/* 数据表格 */}
        <div className="flex-1 min-h-0 bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
          <div className="h-full overflow-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#f8fafc] border-b border-slate-200 text-slate-600 font-semibold text-xs sticky top-0 z-[1]">
                <tr>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">物料编号</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">物料描述</th>
                  <th
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('totalCount')}
                  >
                    <span className="inline-flex items-center gap-1">
                      总装配数量
                      <SortIcon field="totalCount" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('faultCount')}
                  >
                    <span className="inline-flex items-center gap-1">
                      故障数量
                      <SortIcon field="faultCount" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('lrrRate')}
                  >
                    <span className="inline-flex items-center gap-1">
                      故障率 (LRR)
                      <SortIcon field="lrrRate" activeField={sortField} direction={sortDirection} />
                    </span>
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
                        <button
                          onClick={() => fetchData(page)}
                          className="px-3 py-1 text-xs border border-slate-300 rounded bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                        >
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
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${Math.min(100, row.lrrRate * 4)}%`, backgroundColor: color.bar }}
                                />
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
          <div className="flex items-center justify-between px-2 py-2 bg-white rounded-md border border-slate-200 shadow-sm mt-3">
            <span className="text-xs text-slate-500">
              {search.trim() ? (
                <>筛选后 {sortedData.length} 种（共 {total} 种物料），第 {page}/{totalPages} 页</>
              ) : (
                <>共 {total} 种物料，第 {page}/{totalPages} 页</>
              )}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchData(1)}
                disabled={page === 1}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                首页
              </button>
              <button
                onClick={() => fetchData(page - 1)}
                disabled={page <= 1}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
              >
                <ChevronLeft className="w-3 h-3" />
                上一页
              </button>
              <div className="flex items-center gap-1 mx-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = startPage + i;
                  if (p > totalPages) return null;
                  return (
                    <button
                      key={p}
                      onClick={() => fetchData(p)}
                      className={`min-w-[28px] px-1.5 py-1 text-xs rounded transition-colors ${
                        p === page
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => fetchData(page + 1)}
                disabled={page >= totalPages}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
              >
                下一页
                <ChevronRight className="w-3 h-3" />
              </button>
              <button
                onClick={() => fetchData(totalPages)}
                disabled={page >= totalPages}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                末页
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 统计分析弹窗：故障率 Top10 + 装配数据覆盖 */}
      {chartsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setChartsOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white z-[1]">
              <h3 className="text-base font-semibold text-slate-800">LRR 统计分析</h3>
              <button
                onClick={() => setChartsOpen(false)}
                className="p-1 rounded-md hover:bg-slate-100 text-slate-400 transition-colors"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-auto grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Top 10 故障率排行 */}
              <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-700">故障率 Top 10 物料</h3>
                  <span className="text-[11px] text-slate-400">按故障率降序</span>
                </div>
                {topRiskData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-slate-400 text-sm">暂无有装配数据的故障率记录</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart layout="vertical" data={topRiskData} margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                      <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                      <RTooltip formatter={(v) => [`${v}%`, '故障率']} />
                      <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                        {topRiskData.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* 装配占比环形图 */}
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2">装配数据覆盖</h3>
                {stats.total === 0 ? (
                  <div className="h-[260px] flex items-center justify-center text-slate-400 text-sm">暂无数据</div>
                ) : (
                  <>
                  <ResponsiveContainer width="100%" height={210}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {pieData.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      <RTooltip formatter={(v) => [`${v} 种`, '物料']} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* 自定义图例：完整展示名称 + 数量 + 占比，避免饼图扇区标签被窄列裁切 */}
                  <div className="mt-2 space-y-1.5">
                    {pieData.map((d) => {
                      const pct = stats.total > 0 ? Math.round((d.value / stats.total) * 100) : 0;
                      return (
                        <div key={d.name} className="flex items-center justify-between text-xs">
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                            <span className="truncate">{d.name}</span>
                          </span>
                          <span className="text-slate-600 tabular-nums shrink-0 ml-2">
                            {d.value} 种 · {pct}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  </>
                )}
                <div className="text-center text-[11px] text-slate-400 mt-1">
                  共 {stats.total} 种物料
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
