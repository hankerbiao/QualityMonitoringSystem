import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  CircleGauge,
  Clock3,
  Database,
  Eye,
  LogIn,
  MousePointerClick,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { operationsApi } from '../api/operationsApi';
import type {
  OperationsDashboard,
  OperationsDays,
  OperationsSummary,
} from '../types';

const PERIODS: OperationsDays[] = [7, 30, 90];

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatTime(value: string | null): string {
  if (!value) return '暂无记录';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function ChangeIndicator({ value, suffix = '%' }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-xs text-slate-400">暂无上期数据</span>;
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

function SummaryCell({
  icon: Icon,
  label,
  value,
  detail,
  change,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  detail: string;
  change: number | null;
  accent: string;
}) {
  return (
    <div className="min-w-0 px-5 py-4 lg:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${accent}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
          <p className="mt-1 truncate text-xs text-slate-400">{detail}</p>
        </div>
        <ChangeIndicator value={change} />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-28 rounded-md border border-slate-200 bg-white" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
        <div className="h-[360px] rounded-md border border-slate-200 bg-white" />
        <div className="h-[360px] rounded-md border border-slate-200 bg-white" />
      </div>
      <div className="h-64 rounded-md border border-slate-200 bg-white" />
    </div>
  );
}

function ModuleRanking({ data }: { data: OperationsDashboard['modules'] }) {
  const maxUsage = Math.max(...data.map((item) => item.pageViews + item.apiRequests), 1);
  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-800">功能使用排行</h2>
        <p className="mt-1 text-xs text-slate-400">页面访问与业务接口调用的综合热度</p>
      </div>
      <div className="divide-y divide-slate-100 px-5">
        {data.map((item, index) => {
          const usage = item.pageViews + item.apiRequests;
          return (
            <div key={item.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 py-3.5">
              <span className="font-mono text-xs text-slate-400">{String(index + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-slate-700">{item.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{item.activeUsers} 人使用</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${Math.max((usage / maxUsage) * 100, usage ? 4 : 0)}%` }}
                  />
                </div>
              </div>
              <div className="w-24 text-right">
                <p className="font-mono text-sm font-semibold text-slate-700">{formatNumber(usage)}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{item.pageViews} 访问 · {item.apiRequests} 调用</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HealthPanel({ data }: { data: OperationsDashboard }) {
  const healthy = data.health.status === 'healthy';
  const rows = [
    { icon: Server, label: 'API 服务', value: healthy ? '运行正常' : '需要关注', tone: healthy ? 'text-emerald-600' : 'text-amber-600' },
    { icon: Database, label: 'MongoDB', value: data.health.database === 'healthy' ? '连接正常' : '连接异常', tone: 'text-emerald-600' },
    { icon: Clock3, label: '平均响应', value: `${data.summary.avgResponseMs.toFixed(0)} ms`, tone: 'text-slate-700' },
    { icon: CircleGauge, label: '异常请求', value: formatNumber(data.health.errorRequests), tone: data.health.errorRequests ? 'text-rose-600' : 'text-slate-700' },
  ];

  return (
    <section className="self-start border border-slate-200 bg-white rounded-md">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">系统健康</h2>
          <p className="mt-1 text-xs text-slate-400">最近事件 {formatTime(data.health.lastEventAt)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${healthy ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {healthy ? '全部正常' : '服务波动'}
        </span>
      </div>
      <div className="divide-y divide-slate-100 px-5">
        {rows.map(({ icon: Icon, label, value, tone }) => (
          <div key={label} className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </div>
            <span className={`font-mono text-sm font-medium ${tone}`}>{value}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">接口请求成功率</span>
          <span className="font-mono font-semibold text-slate-700">{data.summary.successRate.toFixed(1)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${data.summary.successRate}%` }} />
        </div>
      </div>
    </section>
  );
}

function RecentActivity({ items }: { items: OperationsDashboard['recentActivity'] }) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">最近访问</h2>
          <p className="mt-1 text-xs text-slate-400">最新登录与页面访问记录</p>
        </div>
        <Eye className="h-4 w-4 text-slate-400" />
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-slate-400">暂无访问记录，系统将从现在开始持续采集。</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-400">
              <tr>
                <th className="px-5 py-2.5 font-medium">用户</th>
                <th className="px-5 py-2.5 font-medium">行为</th>
                <th className="px-5 py-2.5 font-medium">功能</th>
                <th className="px-5 py-2.5 text-right font-medium">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={`${item.id}-${item.timestamp}`} className="text-slate-600 hover:bg-slate-50/70">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                        {item.displayName.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <p className="font-medium text-slate-700">{item.displayName}</p>
                        <p className="font-mono text-[11px] text-slate-400">{item.itcode}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">{item.action}</td>
                  <td className="px-5 py-3">{item.module}</td>
                  <td className="px-5 py-3 text-right font-mono text-xs text-slate-400">{formatTime(item.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function OperationsPage() {
  const navigate = useNavigate();
  const [days, setDays] = useState<OperationsDays>(30);
  const [data, setData] = useState<OperationsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await operationsApi.getDashboard(days));
    } catch (err) {
      setError(err instanceof Error ? err.message : '运营数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const summaryCells = useMemo(() => {
    if (!data) return [];
    const summary: OperationsSummary = data.summary;
    return [
      { icon: Users, label: '活跃用户', value: formatNumber(summary.activeUsers), detail: `当前在线 ${summary.currentOnline} · 累计 ${summary.totalUsers}`, change: summary.changes.activeUsers, accent: 'bg-blue-50 text-blue-600' },
      { icon: LogIn, label: '登录次数', value: formatNumber(summary.visits), detail: `近 ${days} 天会话创建次数`, change: summary.changes.visits, accent: 'bg-cyan-50 text-cyan-700' },
      { icon: MousePointerClick, label: '页面浏览', value: formatNumber(summary.pageViews), detail: `${summary.apiRequests} 次业务接口调用`, change: summary.changes.pageViews, accent: 'bg-amber-50 text-amber-700' },
      { icon: ShieldCheck, label: '请求成功率', value: `${summary.successRate.toFixed(1)}%`, detail: `平均响应 ${summary.avgResponseMs.toFixed(0)} ms`, change: summary.changes.successRate, accent: 'bg-emerald-50 text-emerald-700' },
    ];
  }, [data, days]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => navigate('/')} className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800" title="返回首页" aria-label="返回首页">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
              <Activity className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-900">运营监控</h1>
              <p className="truncate text-xs text-slate-400">QualiBoard 使用情况与服务运行状态</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 p-1" aria-label="统计周期">
              {PERIODS.map((period) => (
                <button key={period} onClick={() => setDays(period)} className={`h-7 px-3 text-xs font-medium transition-colors ${days === period ? 'rounded bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  {period} 天
                </button>
              ))}
            </div>
            <button onClick={load} disabled={loading} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:opacity-50" title="刷新数据" aria-label="刷新数据">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {loading && !data ? <DashboardSkeleton /> : error && !data ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center rounded-md border border-slate-200 bg-white text-center">
            <Server className="mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">{error}</p>
            <button onClick={load} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">重新加载</button>
          </div>
        ) : data ? (
          <>
            <section className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4 sm:divide-x sm:divide-y-0 divide-y divide-slate-100">
              {summaryCells.map((item) => <SummaryCell key={item.label} {...item} />)}
            </section>

            {error && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">刷新失败，当前展示上一次成功获取的数据。</div>}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <section>
                  <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-800">使用趋势</h2>
                      <p className="mt-1 text-xs text-slate-400">按日统计活跃用户与页面浏览量</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-blue-500" />页面浏览</span>
                      <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-emerald-500" />活跃用户</span>
                    </div>
                  </div>
                  <div className="h-[300px] px-2 pb-2 pt-5 sm:px-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={data.trend} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis yAxisId="views" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <YAxis yAxisId="users" orientation="right" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ borderRadius: 6, borderColor: '#e2e8f0', fontSize: 12 }} labelFormatter={(_label, payload) => payload?.[0]?.payload?.date ?? ''} formatter={(value, name) => [formatNumber(Number(value)), name === 'pageViews' ? '页面浏览' : '活跃用户']} />
                        <Bar yAxisId="views" dataKey="pageViews" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={28} />
                        <Line yAxisId="users" type="monotone" dataKey="activeUsers" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#10b981' }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                <ModuleRanking data={data.modules} />
              </div>
              <HealthPanel data={data} />
            </div>

            <RecentActivity items={data.recentActivity} />

            <div className="flex flex-col gap-1 px-1 pb-2 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <span>页面访问与接口状态从运营监控功能上线后开始累计，原始事件保留 180 天。</span>
              <span>更新于 {formatTime(data.period.generatedAt)}</span>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
