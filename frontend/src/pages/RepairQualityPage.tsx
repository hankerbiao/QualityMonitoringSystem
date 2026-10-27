import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, CircleHelp, Download, RotateCcw, Search, Wrench } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { RepairQualityCharts } from '../components/repair/RepairQualityCharts';
import { buildRepairQualityWorkbook } from '../components/repair/exportData';
import { rtyApi } from '../api/rtyApi';
import type { RepairQualityOptions, RepairQualityQuery, RepairQualitySummary } from '../types';
import { recentDateRange } from '../utils/dateRange';

function rateStyle(rate: number) {
  if (rate >= 80) return 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200';
  if (rate >= 50) return 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200';
  return 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200';
}

function distributionStyle(percentage: number, index: number): React.CSSProperties {
  const hues = [158, 24, 212, 273, 335, 84, 190, 44, 215];
  const hue = hues[index % hues.length];
  const alpha = percentage ? Math.min(0.24, 0.06 + percentage / 500) : 0;
  return {
    backgroundColor: alpha ? `hsl(${hue} 70% 90% / ${alpha + 0.22})` : undefined,
    color: percentage ? `hsl(${hue} 58% 30%)` : undefined,
  };
}

function MultiSelect({ label, options, value, onChange }: {
  label: string; options: string[]; value: string[]; onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const filtered = options.filter(option => option.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const summary = value.length === 0
    ? `全部${label.replace(/（多选）$/, '')}`
    : value.length === 1 ? value[0] : `${value[0]} 等 ${value.length} 项`;

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  return (
    <div ref={root} className="relative flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
      <span>{label}</span>
      <button type="button" aria-label={label} aria-expanded={open} aria-haspopup="dialog" title={value.join('、') || undefined}
        onClick={() => { setOpen(current => !current); setSearch(''); }}
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-white px-2.5 text-sm font-normal outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 ${value.length ? 'border-teal-300 text-slate-800' : 'border-slate-300 text-slate-500'}`}>
        <span className="truncate">{summary}</span><span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">{value.length > 0 && <span>{value.length}</span>}<ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} /></span>
      </button>
      {open && <div role="dialog" aria-label={`选择${label.replace(/（多选）$/, '')}`} className="absolute left-0 top-full z-50 mt-1 w-full min-w-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-500">已选 {value.length} 项</span>
          <div className="flex items-center gap-3 text-xs"><button type="button" onClick={() => onChange(filtered)} className="font-medium text-teal-700">全选</button><button type="button" onClick={() => onChange([])} className="font-medium text-slate-500">清空</button></div>
        </div>
        <div className="border-b border-slate-100 p-2"><input type="search" aria-label={`搜索${label.replace(/（多选）$/, '')}`} value={search} onChange={event => setSearch(event.target.value)} placeholder={`搜索${label.replace(/（多选）$/, '')}`} className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-normal text-slate-700 outline-none focus:border-teal-400 focus:bg-white" /></div>
        <div className="max-h-56 overflow-y-auto py-1">
          {filtered.length ? filtered.map(option => <label key={option} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs font-normal text-slate-700 hover:bg-teal-50">
            <input type="checkbox" checked={value.includes(option)} onChange={() => onChange(value.includes(option) ? value.filter(item => item !== option) : [...value, option])} className="size-3.5 rounded border-slate-300 accent-teal-700" />
            <span className="min-w-0 flex-1 truncate">{option}</span>
          </label>) : <p className="px-3 py-4 text-center text-xs font-normal text-slate-400">{options.length ? '没有匹配项' : '暂无可选项目'}</p>}
        </div>
      </div>}
    </div>
  );
}

export default function RepairQualityPage() {
  const navigate = useNavigate();
  const dates = useMemo(() => recentDateRange(7), []);
  const [dateFrom, setDateFrom] = useState(dates.from);
  const [dateTo, setDateTo] = useState(dates.to);
  const [options, setOptions] = useState<RepairQualityOptions>({ productModels: [], customers: [], bases: [] });
  const [customers, setCustomers] = useState<string[]>([]);
  const [bases, setBases] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [result, setResult] = useState<RepairQualitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [error, setError] = useState('');
  const [appliedQuery, setAppliedQuery] = useState<RepairQualityQuery | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    let active = true;
    rtyApi.getRepairQualityOptions().then(value => {
      if (active) setOptions(value);
    }).catch(reason => {
      if (active) setOptionsError(reason instanceof Error ? reason.message : '筛选项加载失败');
    });
    return () => { active = false; };
  }, []);

  const query = async (event?: FormEvent) => {
    event?.preventDefault();
    if (loading || exporting) return;
    setLoading(true);
    setError('');
    setExportError('');
    try {
      const params: RepairQualityQuery = {
        dateFrom, dateTo,
        ...(models.length ? { productModels: models } : {}),
        ...(customers.length ? { customers } : {}),
        ...(bases.length ? { bases } : {}),
      };
      setResult(await rtyApi.getRepairQuality(params));
      setAppliedQuery(params);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '维修质量分析失败，请重试');
      setResult(null);
      setAppliedQuery(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void query();
  }, []);

  const reset = () => {
    if (loading || exporting) return;
    setDateFrom(dates.from);
    setDateTo(dates.to);
    setCustomers([]);
    setBases([]);
    setModels([]);
    setResult(null);
    setError('');
    setExportError('');
    setAppliedQuery(null);
  };

  const exportRows = async () => {
    if (!appliedQuery || !result?.snCount || loading || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const data = await rtyApi.getRepairQualityExport(appliedQuery);
      XLSX.writeFile(buildRepairQualityWorkbook(data), `维修首修通过率分析_${appliedQuery.dateFrom}_${appliedQuery.dateTo}.xlsx`);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : '导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  const distribution = result?.distribution ?? [];
  const repeatRate = result?.snCount ? (result.repeatCount / result.snCount) * 100 : 0;
  const averageRepairs = result?.snCount
    ? distribution.reduce((total, item) => total + (item.repairCount === '9+' ? 9 : Number(item.repairCount)) * item.snCount, 0) / result.snCount
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
        <div className="mx-auto flex min-h-15 max-w-[1500px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <button type="button" onClick={() => navigate('/')} className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600" title="返回首页" aria-label="返回首页"><ArrowLeft className="size-4" /></button>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><Wrench className="size-4" /></span>
            <div className="min-w-0"><h1 className="truncate text-base font-semibold text-slate-900">维修首修通过率分析</h1><p className="hidden text-xs text-slate-500 sm:block">首修表现与复修次数分析</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DashboardSwitcher />
            <button type="button" onClick={() => void exportRows()} disabled={loading || exporting || !appliedQuery || !result?.snCount}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-45 sm:px-3"
              title="导出维修首修通过率分析表、销售订单及维修故障明记录" aria-label="导出维修首修通过率分析表、销售订单及维修故障明记录" aria-busy={exporting}>
              <Download className="size-4" /><span className="hidden sm:inline">{exporting ? '导出中' : '导出'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1720px] space-y-3 px-3 py-3 sm:px-5">
        <form onSubmit={query} className="border-b border-slate-200 pb-3">
          <div className="flex flex-wrap items-end gap-2">
            <DateRangePicker label="实际开始日期（订单）" from={dateFrom} to={dateTo} disabled={loading || exporting}
              onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
            <MultiSelect label="客户（多选）" options={options.customers} value={customers} onChange={setCustomers} />
            <MultiSelect label="基地（多选）" options={options.bases} value={bases} onChange={setBases} />
            <MultiSelect label="机型（多选）" options={options.productModels} value={models} onChange={setModels} />
            <div className="flex gap-2">
              <button type="submit" disabled={loading || exporting} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-700 px-2.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"><Search className="size-3.5" />{loading ? '分析中' : '查询'}</button>
              <button type="button" onClick={reset} disabled={loading || exporting} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RotateCcw className="size-3.5" />重置</button>
            </div>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500"><CircleHelp className="size-3" />按订单实际开始日期筛选 SN；维修次数统计这些 SN 的完整生命周期 NG 记录。</p>
          {optionsError && <p role="alert" className="mt-2 text-xs text-amber-700">筛选项加载失败：{optionsError}</p>}
        </form>

        {error && <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"><AlertCircle className="size-4 shrink-0" />{error}</div>}
        {exportError && <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"><AlertCircle className="size-4 shrink-0" />导出失败：{exportError}</div>}
        {!result && !error && <div className="flex min-h-64 flex-col items-center justify-center border-y border-slate-200 text-center text-slate-500">
          {loading ? <><div className="size-8 animate-spin rounded-full border-2 border-teal-700 border-t-transparent" /><p className="mt-3 text-sm font-medium text-slate-700">正在分析维修记录</p><p className="mt-1 text-xs text-slate-400">按订单实际开始日期筛选，并汇总 SN 完整维修记录</p></> : <><Wrench className="size-8 text-teal-700" /><p className="mt-3 text-sm font-medium text-slate-700">选择日期和筛选条件查看维修表现</p><p className="mt-1 text-xs text-slate-400">默认周期为最近 7 天</p></>}
        </div>}
        {result && <>
          <section aria-label="关键指标" className="grid grid-cols-2 gap-x-3 gap-y-2 border-y border-slate-200 bg-white px-3 py-2.5 sm:grid-cols-3 xl:grid-cols-6">
            <Metric label="维修 SN" value={result.snCount.toLocaleString()} detail="去重后的设备数" />
            <Metric label="首修通过率" value={`${result.firstPassRate.toFixed(2)}%`} detail="仅有 1 条 NG 记录的 SN 占比" tone="emerald" />
            <Metric label="首修通过 SN" value={result.firstPassCount.toLocaleString()} detail="生命周期内维修记录为 1 次" />
            <Metric label="发生复修 SN" value={result.repeatCount.toLocaleString()} detail="生命周期内维修记录超过 1 次" tone="orange" />
            <Metric label="复修率" value={`${repeatRate.toFixed(2)}%`} detail="发生复修 SN / 维修 SN" tone="orange" />
            <Metric label="平均维修次数" value={averageRepairs.toFixed(2)} detail="每台维修 SN 的 NG 记录均值" />
          </section>

          {result.snCount === 0 ? <div className="flex min-h-56 flex-col items-center justify-center border-y border-slate-200 text-slate-400"><Wrench className="size-7" /><p className="mt-2 text-sm">当前筛选条件下没有维修 SN</p></div> : <>
            <RepairQualityCharts summary={result} />

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div><h2 className="text-xs font-semibold text-slate-900">客户 / 基地维修表现</h2><p className="mt-0.5 text-[10px] text-slate-500">客户与基地来自维修记录对应生产订单；占比以本组维修 SN 为分母。</p></div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500"><span className="rounded-sm bg-emerald-100 px-1.5 py-0.5 text-emerald-800">高 ≥80%</span><span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-amber-800">中 50–79%</span><span className="rounded-sm bg-rose-100 px-1.5 py-0.5 text-rose-800">低 &lt;50%</span></div>
              </div>
              <div className="max-h-[62vh] overflow-auto border border-slate-300 bg-white shadow-sm">
                <table className="min-w-[1040px] w-full border-collapse text-right text-[10px] tabular-nums sm:text-[11px]">
                  <thead className="sticky top-0 z-10 text-slate-700"><tr className="bg-slate-100">
                    <th rowSpan={2} className="sticky left-0 z-20 min-w-32 border border-slate-300 bg-slate-100 px-2 py-1.5 text-left">客户</th><th rowSpan={2} className="sticky left-32 z-20 min-w-20 border border-slate-300 bg-slate-100 px-2 py-1.5 text-left">基地</th><th rowSpan={2} className="min-w-16 border border-slate-300 px-1.5 py-1.5">维修 SN</th><th rowSpan={2} className="min-w-20 border border-slate-300 bg-teal-50 px-1.5 py-1.5 text-teal-900">首修通过率</th>
                    {distribution.map((item, index) => <th key={item.repairCount} colSpan={2} style={distributionStyle(item.percentage, index)} className="min-w-[76px] border border-slate-300 px-1 py-1.5">{item.repairCount === '9+' ? '9次+' : `${item.repairCount}次`}</th>)}
                  </tr><tr className="bg-slate-50">{distribution.flatMap((item, index) => [<th key={`${item.repairCount}-count`} style={distributionStyle(item.percentage, index)} className="border border-slate-300 px-1 py-1">数量</th>, <th key={`${item.repairCount}-pct`} style={distributionStyle(item.percentage, index)} className="border border-slate-300 px-1 py-1">占比</th>])}</tr></thead>
                  <tbody>{result.groups.map((row, rowIndex) => <tr key={`${row.customer}-${row.base}`} className={`${rowIndex % 2 ? 'bg-slate-50/70' : 'bg-white'} hover:bg-cyan-50`}>
                    <th className={`sticky left-0 z-[1] border border-slate-200 px-2 py-1.5 text-left font-medium text-slate-800 ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'} group-hover:bg-cyan-50`}>{row.customer}</th><td className={`sticky left-32 z-[1] border border-slate-200 px-2 py-1.5 text-left text-slate-600 ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}`}>{row.base}</td><td className="border border-slate-200 px-1.5 py-1.5 font-semibold text-slate-800">{row.snCount}</td><td className="border border-slate-200 px-1.5 py-1.5"><span className={`inline-flex min-w-[3.5rem] justify-center rounded-sm px-1.5 py-0.5 font-semibold ${rateStyle(row.firstPassRate)}`}>{row.firstPassRate.toFixed(2)}%</span></td>
                    {row.distribution.map((item, index) => <FragmentCells key={item.repairCount} count={item.snCount} percentage={item.percentage} style={distributionStyle(item.percentage, index)} />)}
                  </tr>)}</tbody>
                </table>
              </div>
            </section>
          </>}
        </>}
      </main>
    </div>
  );
}

function FragmentCells({ count, percentage, style }: { count: number; percentage: number; style: React.CSSProperties }) {
  return <><td style={style} className="border border-slate-200 px-1 py-1.5 font-medium">{count || '-'}</td><td style={style} className="border border-slate-200 px-1 py-1.5">{count ? `${percentage.toFixed(1)}%` : '-'}</td></>;
}

function Metric({ label, value, detail, tone = 'slate' }: { label: string; value: string; detail: string; tone?: 'slate' | 'emerald' | 'orange' }) {
  const palette = tone === 'emerald' ? 'text-emerald-800' : tone === 'orange' ? 'text-orange-700' : 'text-slate-900';
  return <article className="border-l-2 border-teal-200 py-0.5 pl-2.5"><p className="text-[10px] font-medium text-slate-500">{label}</p><p className={`mt-0.5 text-xl font-semibold tabular-nums ${palette}`}>{value}</p><p className="mt-0.5 flex items-center gap-1 text-[10px] leading-tight text-slate-400"><CheckCircle2 className="size-2.5 shrink-0" />{detail}</p></article>;
}
