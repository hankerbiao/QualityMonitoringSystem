import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Download, Factory, Gauge, RefreshCw, Search, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { rtyApi } from '../api/rtyApi';
import type { StationPassRate } from '../types';

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: formatDateInput(from), to: formatDateInput(to) };
}

function formatNumber(value: number) {
  return value.toLocaleString('zh-CN');
}

function rateColor(rate: number) {
  if (rate >= 98) return { text: 'text-emerald-700', bar: '#10b981' };
  if (rate >= 95) return { text: 'text-amber-700', bar: '#f59e0b' };
  return { text: 'text-red-700', bar: '#ef4444' };
}

export default function StationPassRatePage() {
  const navigate = useNavigate();
  const [initialDateRange] = useState(defaultDateRange);
  const [dateFrom, setDateFrom] = useState(initialDateRange.from);
  const [dateTo, setDateTo] = useState(initialDateRange.to);
  const [rows, setRows] = useState<StationPassRate[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (dateFrom > dateTo) {
      setError('开始日期不能晚于结束日期');
      setRows([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRows(await rtyApi.getStationPassRates(dateFrom, dateTo));
    } catch (err) {
      console.error('Failed to fetch station pass rates', err);
      setError('工位过站数据加载失败，请点击刷新重试');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      `${row.stationCode} ${row.stationName}`.toLocaleLowerCase().includes(keyword),
    );
  }, [rows, search]);

  const summary = useMemo(() => {
    const inputCount = rows.reduce((sum, row) => sum + row.inputCount, 0);
    const defectCount = rows.reduce((sum, row) => sum + row.defectCount, 0);
    return {
      stationCount: rows.length,
      inputCount,
      defectCount,
      passRate: inputCount ? ((inputCount - defectCount) / inputCount) * 100 : 100,
    };
  }, [rows]);

  const exportRows = () => {
    const data = filteredRows.map((row) => ({
      工位编码: row.stationCode,
      工位名称: row.stationName,
      过站量: row.inputCount,
      维修SN数: row.defectCount,
      直通率: `${row.passRate}%`,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, '工位过站直通率');
    XLSX.writeFile(book, `工位过站直通率_${dateFrom}_${dateTo}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex min-h-12 max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              title="返回首页"
              aria-label="返回首页"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-cyan-600 text-white">
              <Factory className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-950">工位过站直通率看板</h1>
              <p className="text-xs text-slate-500">过站记录为分母 · 匹配维修工位为分子</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex size-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              title="刷新数据"
              aria-label="刷新数据"
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={exportRows}
              disabled={loading || filteredRows.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:border-cyan-300 hover:bg-cyan-50 disabled:opacity-40"
              title="导出当前结果"
            >
              <Download className="size-4" />导出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <CalendarDays className="size-4 text-cyan-600" />统计范围
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-xs font-medium text-slate-700">
              开始日期
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-700">
              结束日期
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <p className="text-xs text-slate-500 sm:pb-2">编码规则：先取冒号前内容，再取最后一个 `-` 后的编码。</p>
          </div>
        </section>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: '工位数', value: summary.stationCount, detail: '有过站记录的工位', icon: Factory, tint: 'text-cyan-700 bg-cyan-50' },
            { label: '过站量', value: summary.inputCount, detail: '去重后的过站 SN', icon: Gauge, tint: 'text-blue-700 bg-blue-50' },
            { label: '维修 SN 数', value: summary.defectCount, detail: '匹配工位的维修 SN', icon: Wrench, tint: 'text-red-700 bg-red-50' },
            { label: '整体直通率', value: `${summary.passRate.toFixed(2)}%`, detail: '（过站量 - 维修 SN）÷ 过站量', icon: Gauge, tint: 'text-emerald-700 bg-emerald-50' },
          ].map(({ label, value, detail, icon: Icon, tint }) => (
            <div key={label} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-md ${tint}`}><Icon className="size-4" /></div>
              <div className="min-w-0"><div className="truncate text-[11px] text-slate-500">{label}</div><div className="font-mono text-xl font-bold text-slate-800">{typeof value === 'number' ? formatNumber(value) : value}</div><div className="truncate text-[11px] text-slate-400">{detail}</div></div>
            </div>
          ))}
        </section>

        <section className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="relative w-full max-w-sm"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工位编码或名称" className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-200" /></div>
          <span className="shrink-0 text-xs text-slate-400">{filteredRows.length} / {rows.length} 个工位</span>
        </section>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="overflow-auto"><table className="w-full min-w-[720px] text-left text-sm">
            <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"><tr><th className="px-4 py-3">工位编码</th><th className="px-4 py-3">工位名称</th><th className="px-4 py-3 text-right">过站量（分母）</th><th className="px-4 py-3 text-right">维修 SN（分子）</th><th className="px-4 py-3 text-right">直通率</th></tr></thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? <tr><td colSpan={5} className="px-4 py-14 text-center text-slate-500">正在加载工位数据...</td></tr> : error ? <tr><td colSpan={5} className="px-4 py-14 text-center text-red-500">加载失败，请点击刷新重试</td></tr> : filteredRows.length === 0 ? <tr><td colSpan={5} className="px-4 py-14 text-center text-slate-500">暂无符合条件的工位数据</td></tr> : filteredRows.map((row) => { const color = rateColor(row.passRate); return <tr key={row.stationCode} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono font-semibold text-slate-800">{row.stationCode}</td><td className="px-4 py-3 text-slate-600">{row.stationName || '-'}</td><td className="px-4 py-3 text-right font-mono">{formatNumber(row.inputCount)}</td><td className="px-4 py-3 text-right font-mono text-red-600">{formatNumber(row.defectCount)}</td><td className="px-4 py-3"><div className="flex items-center justify-end gap-3"><div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, row.passRate))}%`, backgroundColor: color.bar }} /></div><span className={`w-16 text-right font-mono font-semibold ${color.text}`}>{row.passRate.toFixed(2)}%</span></div></td></tr>; })}
            </tbody>
          </table></div>
        </section>
      </main>
    </div>
  );
}
