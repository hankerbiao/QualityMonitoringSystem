import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSearch,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { doaApi } from '../api/doaApi';
import { Modal } from '../components/ui/Modal';
import type { DoaRawDashboard, DoaRawItem } from '../types/doa';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatPercent(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%';
}

function formatDate(value: unknown): string {
  if (!value) return '-';
  const text = String(value);
  return text.length > 16 ? text.slice(0, 16) : text;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function statusLabel(status: string): string {
  return {
    success: '已补采',
    failed: '补采失败',
    pending: '待采集',
    skipped: '已跳过',
  }[status] || status || '未填写';
}

function StatCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
  icon: typeof Database;
}) {
  return (
    <div className="border-b border-slate-100 px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{label}</span>
        <span className={`flex size-8 items-center justify-center rounded-md ${tone}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function DetailModal({ item, onClose }: { item: DoaRawItem; onClose: () => void }) {
  return (
    <Modal title={`DOA 记录详情 · ${item.id}`} onClose={onClose} maxWidth="max-w-4xl">
      <div className="space-y-5 p-5">
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">DOA 原始字段</h3>
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            {Object.entries(item.data).map(([key, value]) => (
              <div key={key} className="min-w-0 border-b border-slate-100 pb-2">
                <dt className="text-xs text-slate-400">{key}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{displayValue(value)}</dd>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">销售订单补采信息</h3>
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            {Object.entries(item.enrichment).map(([key, value]) => (
              <div key={key} className="min-w-0 border-b border-slate-100 pb-2">
                <dt className="text-xs text-slate-400">{key === 'status' ? '状态' : key}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{key === 'status' ? statusLabel(String(value)) : displayValue(value)}</dd>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

export default function DoaScsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DoaRawDashboard | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DoaRawItem | null>(null);

  const load = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError('');
    try {
      const result = await doaApi.getRaw(targetPage);
      setData(result);
      setPage(result.pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DOA 数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  const pagination = data?.pagination;
  const summary = data?.summary;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => navigate('/')} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="返回首页" aria-label="返回首页">
              <ArrowLeft className="size-4" />
            </button>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white"><Database className="size-5" /></span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-900">SCS 数据明细</h1>
              <p className="truncate text-xs text-slate-400">仅显示 is_5000=true 的 DOA 原始数据</p>
            </div>
          </div>
          <button type="button" onClick={() => load(page)} disabled={loading} className="flex size-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50" title="刷新数据" aria-label="刷新数据">
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {loading && !data ? (
          <div className="relative space-y-4">
            <div className="space-y-4 motion-safe:animate-pulse" aria-hidden="true"><div className="h-28 rounded-md border border-slate-200 bg-white" /><div className="h-80 rounded-md border border-slate-200 bg-white" /><div className="h-64 rounded-md border border-slate-200 bg-white" /></div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-live="polite">
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white/95 px-4 py-3 text-sm font-medium text-slate-600 shadow-sm">
                <LoaderCircle className="size-4 animate-spin text-emerald-600 motion-reduce:animate-none" />
                <span>正在加载 DOA 数据</span>
              </div>
            </div>
          </div>
        ) : error && !data ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center rounded-md border border-slate-200 bg-white text-center"><XCircle className="mb-3 size-8 text-rose-300" /><p className="text-sm font-medium text-slate-700">{error}</p><button type="button" onClick={() => load(page)} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">重新加载</button></div>
        ) : data && pagination ? (
          <>
            {error && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">刷新失败，当前展示上一次成功获取的数据。</div>}
            {summary && (
              <section className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="SCS 总记录" value={formatNumber(summary.total)} detail="当前原始数据范围" tone="bg-emerald-50 text-emerald-600" icon={Database} />
                <StatCard label="判定结果为是" value={formatNumber(summary.judgmentYes)} detail={`占比 ${formatPercent(summary.judgmentYes, summary.total)} · 否 ${formatNumber(summary.judgmentNo)}`} tone="bg-blue-50 text-blue-600" icon={CheckCircle2} />
                <StatCard label="补采成功" value={formatNumber(summary.enrichedSuccess)} detail={`成功率 ${formatPercent(summary.enrichedSuccess, summary.total)}`} tone="bg-amber-50 text-amber-600" icon={CheckCircle2} />
                <StatCard label="最近受理时间" value={formatDate(summary.latestAcceptedAt)} detail="按 SCS 受理日期统计" tone="bg-slate-100 text-slate-600" icon={CalendarDays} />
              </section>
            )}
            <section className="relative overflow-hidden rounded-md border border-slate-200 bg-white">
              {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/65 backdrop-blur-[1px]" role="status" aria-live="polite"><div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-sm"><LoaderCircle className="size-4 animate-spin text-emerald-600 motion-reduce:animate-none" /><span>正在刷新 DOA 数据</span></div></div>}
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-slate-800">DOA 明细</h2><p className="mt-1 text-xs text-slate-400">按受理时间倒序，点击记录查看完整字段</p></div><FileSearch className="size-4 text-slate-400" /></div>
              {data.items.length === 0 ? <div className="px-5 py-16 text-center text-sm text-slate-400">暂无 DOA 数据</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-400"><tr><th className="px-5 py-2.5 font-medium">服务单号</th><th className="px-5 py-2.5 font-medium">受理时间</th><th className="px-5 py-2.5 font-medium">发货日期</th><th className="px-5 py-2.5 font-medium">客户</th><th className="px-5 py-2.5 font-medium">产品/备件</th><th className="px-5 py-2.5 font-medium">DOA 类型</th><th className="px-5 py-2.5 font-medium">判定</th><th className="px-5 py-2.5 font-medium">处理状态</th><th className="px-5 py-2.5 font-medium">销售订单</th><th className="px-5 py-2.5 font-medium">补采状态</th></tr></thead><tbody className="divide-y divide-slate-100">{data.items.map((item) => <tr key={item.id} onClick={() => setSelected(item)} className="cursor-pointer text-slate-600 hover:bg-emerald-50/40"><td className="max-w-[180px] truncate px-5 py-3 font-medium text-slate-700" title={displayValue(item.data['服务单号'])}>{displayValue(item.data['服务单号'] || item.data['服务单号_id'])}</td><td className="whitespace-nowrap px-5 py-3 text-xs">{formatDate(item.data['受理时间'])}</td><td className="whitespace-nowrap px-5 py-3 text-xs">{displayValue(item.data['发货日期'])}</td><td className="max-w-[160px] truncate px-5 py-3" title={displayValue(item.data['客户'])}>{displayValue(item.data['客户'])}</td><td className="max-w-[220px] truncate px-5 py-3" title={displayValue(item.data['产品名称'] || item.data['备件名称'] || item.data['产品/备件名称'])}>{displayValue(item.data['产品名称'] || item.data['备件名称'] || item.data['产品/备件名称'])}</td><td className="px-5 py-3">{displayValue(item.data['DOA类型'])}</td><td className="px-5 py-3">{displayValue(item.data['判定结果'])}</td><td className="px-5 py-3">{displayValue(item.data['处理状态'])}</td><td className="px-5 py-3 font-mono text-xs">{displayValue(item.enrichment.sales_order)}</td><td className="px-5 py-3"><span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{statusLabel(item.enrichment.status)}</span></td></tr>)}</tbody></table></div>}
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><span className="text-xs text-slate-400">第 {pagination.page} 页 · 共 {formatNumber(pagination.total)} 条</span><div className="flex items-center gap-2"><button type="button" onClick={() => load(page - 1)} disabled={loading || page <= 1} className="flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" title="上一页" aria-label="上一页"><ChevronLeft className="size-4" /></button><button type="button" onClick={() => load(page + 1)} disabled={loading || !pagination.hasMore} className="flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" title="下一页" aria-label="下一页"><ChevronRight className="size-4" /></button></div></div>
            </section>
          </>
        ) : null}
      </main>
      {selected && <DetailModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
