import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, Download, RotateCcw, Search, Wrench } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { HelpTooltip } from '../components/shared/HelpTooltip';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { MultiSelect } from '../components/shared/MultiSelect';
import { RepairQualityCharts } from '../components/repair/RepairQualityCharts';
import { RepairQualityDetailDialog } from '../components/repair/RepairQualityDetailDialog';
import { buildRepairQualityWorkbook } from '../components/repair/exportData';
import { rtyApi } from '../api/rtyApi';
import type { RepairQualityOptions, RepairQualityQuery, RepairQualitySummary } from '../types';
import type { RepairQualityBucket, RepairQualityDetailQuery } from '../types/rty';
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
  const [detail, setDetail] = useState<{ query: RepairQualityDetailQuery; expectedCount: number; denominator?: number } | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);

  const openDetail = (customer: string, base: string, bucket: RepairQualityBucket, expectedCount: number, denominator?: number) => {
    if (!appliedQuery || !expectedCount || loading) return;
    setDetail({ query: { ...appliedQuery, customer, base, bucket }, expectedCount, denominator });
  };

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
      XLSX.writeFile(buildRepairQualityWorkbook(data), `维修通过率分析_${appliedQuery.dateFrom}_${appliedQuery.dateTo}.xlsx`);
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
            <div className="flex min-w-0 items-center gap-1"><h1 className="truncate text-base font-semibold text-slate-900">维修通过率分析</h1><HelpTooltip label="查看维修通过率分析说明">
              <p>分析首修通过率及维修 SN 的完整生命周期复修次数。</p>
              <p className="mt-1">按订单实际开始日期筛选 SN；维修次数统计这些 SN 的完整生命周期 NG 记录。默认周期为最近 7 天。</p>
            </HelpTooltip></div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DashboardSwitcher />
            <button type="button" onClick={() => void exportRows()} disabled={loading || exporting || !appliedQuery || !result?.snCount}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-45 sm:px-3"
              title="导出维修通过率分析表、销售订单及维修故障明细记录" aria-label="导出维修通过率分析表、销售订单及维修故障明细记录" aria-busy={exporting}>
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
          {optionsError && <p role="alert" className="mt-2 text-xs text-amber-700">筛选项加载失败：{optionsError}</p>}
        </form>

        {error && <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"><AlertCircle className="size-4 shrink-0" />{error}</div>}
        {exportError && <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"><AlertCircle className="size-4 shrink-0" />导出失败：{exportError}</div>}
        {!result && !error && <div className="flex min-h-64 flex-col items-center justify-center border-y border-slate-200 text-center text-slate-500">
          {loading ? <><div className="size-8 animate-spin rounded-full border-2 border-teal-700 border-t-transparent" /><p className="mt-3 text-sm font-medium text-slate-700">正在分析维修记录</p></> : <><Wrench className="size-8 text-teal-700" /><p className="mt-3 text-sm font-medium text-slate-700">选择日期和筛选条件查看维修表现</p></>}
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
                <div className="flex items-center gap-1"><h2 className="text-xs font-semibold text-slate-900">客户 / 基地维修表现</h2><HelpTooltip label="查看客户与基地统计说明">客户与基地来自维修记录对应的生产订单；各次数占比以本组维修 SN 为分母。</HelpTooltip></div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500"><span className="rounded-sm bg-emerald-100 px-1.5 py-0.5 text-emerald-800">高 ≥80%</span><span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-amber-800">中 50–79%</span><span className="rounded-sm bg-rose-100 px-1.5 py-0.5 text-rose-800">低 &lt;50%</span></div>
              </div>
              <div className="max-h-[62vh] overflow-auto border border-slate-300 bg-white shadow-sm">
                <table className="min-w-[1040px] w-full border-collapse text-right text-[10px] tabular-nums sm:text-[11px]">
                  <thead className="sticky top-0 z-10 text-slate-700"><tr className="bg-slate-100">
                    <th rowSpan={2} className="sticky left-0 z-20 min-w-32 border border-slate-300 bg-slate-100 px-2 py-1.5 text-left">客户</th><th rowSpan={2} className="sticky left-32 z-20 min-w-20 border border-slate-300 bg-slate-100 px-2 py-1.5 text-left">基地</th><th rowSpan={2} className="min-w-16 border border-slate-300 px-1.5 py-1.5">维修 SN</th><th rowSpan={2} className="min-w-20 border border-slate-300 bg-teal-50 px-1.5 py-1.5 text-teal-900">首修通过率</th>
                    {distribution.map((item, index) => <th key={item.repairCount} colSpan={2} style={distributionStyle(item.percentage, index)} className="min-w-[76px] border border-slate-300 px-1 py-1.5">{item.repairCount === '9+' ? '9次+' : `${item.repairCount}次`}</th>)}
                  </tr><tr className="bg-slate-50">{distribution.flatMap((item, index) => [<th key={`${item.repairCount}-count`} style={distributionStyle(item.percentage, index)} className="border border-slate-300 px-1 py-1">数量</th>, <th key={`${item.repairCount}-pct`} style={distributionStyle(item.percentage, index)} className="border border-slate-300 px-1 py-1">占比</th>])}</tr></thead>
                  <tbody>{result.groups.map((row, rowIndex) => <tr key={`${row.customer}-${row.base}`} className={`${rowIndex % 2 ? 'bg-slate-50/70' : 'bg-white'} hover:bg-cyan-50`}>
                    <th className={`sticky left-0 z-[1] border border-slate-200 px-2 py-1.5 text-left font-medium text-slate-800 ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'} group-hover:bg-cyan-50`}>{row.customer}</th><td className={`sticky left-32 z-[1] border border-slate-200 px-2 py-1.5 text-left text-slate-600 ${rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}`}>{row.base}</td><td className="border border-slate-200 px-1.5 py-1.5 font-semibold text-slate-800"><button type="button" disabled={loading || !row.snCount} onClick={() => openDetail(row.customer, row.base, 'all', row.snCount)} aria-label={`${row.customer} ${row.base} 全部维修 SN 明细`} className="underline decoration-dotted underline-offset-2 hover:text-teal-700 disabled:no-underline">{row.snCount}</button></td><td className="border border-slate-200 px-1.5 py-1.5"><button type="button" disabled={loading || !row.firstPassCount} onClick={() => openDetail(row.customer, row.base, '1', row.firstPassCount, row.snCount)} aria-label={`${row.customer} ${row.base} 首修通过明细`} className={`inline-flex min-w-[3.5rem] justify-center rounded-sm px-1.5 py-0.5 font-semibold ${rateStyle(row.firstPassRate)} enabled:underline enabled:decoration-dotted enabled:underline-offset-2`}>{row.firstPassRate.toFixed(2)}%</button></td>
                    {row.distribution.map((item, index) => <FragmentCells key={item.repairCount} count={item.snCount} percentage={item.percentage} style={distributionStyle(item.percentage, index)} label={`${row.customer} ${row.base} 维修 ${item.repairCount} 次`} disabled={loading} onOpen={() => openDetail(row.customer, row.base, item.repairCount as RepairQualityBucket, item.snCount)} />)}
                  </tr>)}</tbody>
                </table>
              </div>
            </section>
          </>}
        </>}
      </main>
      {detail && <RepairQualityDetailDialog query={detail.query} expectedCount={detail.expectedCount} denominator={detail.denominator} onClose={closeDetail} />}
    </div>
  );
}

function FragmentCells({ count, percentage, style, label, disabled, onOpen }: { count: number; percentage: number; style: React.CSSProperties; label: string; disabled: boolean; onOpen: () => void }) {
  return <>{(['数量', '占比'] as const).map(kind => <td key={kind} style={style} className="border border-slate-200 px-1 py-1.5"><button type="button" disabled={disabled || !count} onClick={onOpen} aria-label={`${label} ${kind}明细`} className="enabled:underline enabled:decoration-dotted enabled:underline-offset-2 enabled:hover:text-teal-700">{count ? kind === '数量' ? count : `${percentage.toFixed(1)}%` : '-'}</button></td>)}</>;
}

function Metric({ label, value, detail, tone = 'slate' }: { label: string; value: string; detail: string; tone?: 'slate' | 'emerald' | 'orange' }) {
  const palette = tone === 'emerald' ? 'text-emerald-800' : tone === 'orange' ? 'text-orange-700' : 'text-slate-900';
  return <article className="border-l-2 border-teal-200 py-0.5 pl-2.5"><div className="flex items-center gap-1"><p className="text-[10px] font-medium text-slate-500">{label}</p><HelpTooltip label={`查看${label}说明`}>{detail}</HelpTooltip></div><p className={`mt-0.5 text-xl font-semibold tabular-nums ${palette}`}>{value}</p></article>;
}
