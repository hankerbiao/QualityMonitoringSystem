import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Filter,
  Home,
  RotateCcw,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { doaApi } from "../api/doaApi";
import type {
  DoaDashboard,
  DoaFilters,
  DoaOptions,
  DoaTimeGranularity,
} from "../types/doa";
import { DashboardSwitcher } from "../components/shared/DashboardSwitcher";
import { DateRangePicker } from "../components/shared/DateRangePicker";
import { recentDateRange } from "../utils/dateRange";

function defaultFilters(): DoaFilters {
  const range = recentDateRange(7);
  return {
    dateFrom: range.from,
    dateTo: range.to,
    customer: "",
    model: "",
    timeGranularity: "month",
  };
}
function readFilters(params: URLSearchParams): DoaFilters {
  const granularity = params.get("timeGranularity");
  const defaults = defaultFilters();
  return {
    dateFrom: params.get("dateFrom") || defaults.dateFrom,
    dateTo: params.get("dateTo") || defaults.dateTo,
    acceptedDateFrom: params.get("acceptedDateFrom") || undefined,
    acceptedDateTo: params.get("acceptedDateTo") || undefined,
    customer: params.get("customer") || "",
    model: params.get("model") || "",
    timeGranularity:
      granularity === "year" || granularity === "day" ? granularity : "month",
  };
}
function num(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(
    value,
  );
}
function rate(value: number | null) {
  return value == null ? "—" : `${value.toFixed(2)}%`;
}
function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function periodLabel(value: string) {
  if (value.length === 7) return value.replace("-", ".");
  if (value.length === 10) return value.slice(5).replace("-", ".");
  return value;
}
function filtersForPeriod(filters: DoaFilters, period: string): DoaFilters {
  if (filters.timeGranularity === "day")
    return { ...filters, acceptedDateFrom: period, acceptedDateTo: period };
  if (filters.timeGranularity === "year")
    return {
      ...filters,
      acceptedDateFrom: `${period}-01-01`,
      acceptedDateTo: `${period}-12-31`,
    };
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return filters;
  const lastDay = String(new Date(year, month, 0).getDate()).padStart(2, "0");
  return {
    ...filters,
    acceptedDateFrom: `${period}-01`,
    acceptedDateTo: `${period}-${lastDay}`,
  };
}
function Stat({
  label,
  value,
  detail,
  edge,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  edge: string;
}) {
  return (
    <div className={`min-w-0 border-l-2 bg-white px-4 py-3 ${edge}`}>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      <p className="mt-2 truncate font-mono text-2xl font-semibold tabular-nums text-slate-950">
        {value}
      </p>
      <div className="mt-1 min-h-4 text-xs leading-5 text-slate-500">
        {detail}
      </div>
    </div>
  );
}

export default function DoaPage() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<DoaFilters>(() => readFilters(params));
  const [options, setOptions] = useState<DoaOptions>({
    customers: [],
    models: [],
  });
  const [data, setData] = useState<DoaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [rankingDimension, setRankingDimension] = useState<
    "customer" | "model"
  >("customer");
  const load = useCallback(async (next: DoaFilters) => {
    setLoading(true);
    setError("");
    try {
      setData(await doaApi.getDashboard(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "DOA 数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    doaApi
      .getOptions()
      .then(setOptions)
      .catch(() => undefined);
    load(filters);
  }, [load]);
  const apply = (patch: Partial<DoaFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setParams(new URLSearchParams(doaApi.buildQuery(next)));
    load(next);
  };
  const summary = data?.summary;
  const rankingItems = [
    ...(rankingDimension === "customer"
      ? data?.byCustomer || []
      : data?.byModel || []),
  ]
    .sort((a, b) => (b.repairRate ?? -1) - (a.repairRate ?? -1))
    .slice(0, 10);
  const filterSummary = [
    `发货 ${filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom || "不限"} 至 ${filters.dateTo || "不限"}`
      : "全部日期"}`,
    ...(filters.acceptedDateFrom || filters.acceptedDateTo
      ? [
          `受理 ${filters.acceptedDateFrom || "不限"} 至 ${filters.acceptedDateTo || "不限"}`,
        ]
      : []),
    filters.customer || "全部客户",
    filters.model || "全部机型",
    filters.timeGranularity === "year"
      ? "按年"
      : filters.timeGranularity === "day"
        ? "按日"
        : "按月",
  ].join(" · ");
  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/"
              aria-label="返回首页"
              title="返回首页"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
            >
              <Home className="size-4" />
              返回首页
            </Link>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-slate-950">
                DOA 质量看板
              </p>
              <p className="truncate text-xs text-slate-600">
                5000 公司销售订单 · SCS 判定结果
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                  <Clock className="size-3" aria-hidden="true" />
                  数据更新至 {formatDateTime(summary?.latestDataAt)}
                </span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <DashboardSwitcher />
            <Link
              to="/doa/raw"
              className="text-sm font-medium text-slate-600 hover:text-emerald-700"
            >
              SCS 原始数据
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        <section className="border-y border-slate-200 bg-white">
          <div className="flex min-h-12 items-center justify-between gap-3 px-3 sm:px-4">
            <button
              type="button"
              aria-expanded={filtersExpanded}
              aria-controls={filtersExpanded ? "doa-filter-controls" : undefined}
              onClick={() => setFiltersExpanded((expanded) => !expanded)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <Filter className="size-4 shrink-0 text-emerald-700" />
              <span className="shrink-0 text-sm font-semibold text-slate-800">
                筛选条件
              </span>
              <span className="truncate text-xs text-slate-500">{filterSummary}</span>
              <ChevronDown
                className={`size-4 shrink-0 text-slate-500 transition-transform ${filtersExpanded ? "rotate-180" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={() => apply(defaultFilters())}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-slate-600 transition-colors hover:text-emerald-700"
            >
              <RotateCcw className="size-3.5" />
              重置
            </button>
          </div>
          {filtersExpanded && (
            <div
              id="doa-filter-controls"
              className="border-t border-slate-100 px-3 py-3 sm:px-4"
            >
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <div className="col-span-2 min-w-0 md:col-span-2">
                  <DateRangePicker
                    label="实际发货日期"
                    from={filters.dateFrom}
                    to={filters.dateTo}
                    disabled={loading}
                    onChange={(dateFrom, dateTo) =>
                      apply({ dateFrom, dateTo })
                    }
                  />
                </div>
                <label className="text-xs font-medium text-slate-700">
                  客户
                  <select
                    value={filters.customer}
                    onChange={(e) => apply({ customer: e.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm"
                  >
                    <option value="">全部客户</option>
                    {options.customers.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-700">
                  机型
                  <select
                    value={filters.model}
                    onChange={(e) => apply({ model: e.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm"
                  >
                    <option value="">全部机型</option>
                    {options.models.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-700">
                  趋势粒度
                  <select
                    value={filters.timeGranularity}
                    onChange={(e) =>
                      apply({
                        timeGranularity: e.target.value as DoaTimeGranularity,
                      })
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm"
                  >
                    <option value="year">按年</option>
                    <option value="month">按月</option>
                    <option value="day">按日</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </section>
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <section className="grid grid-cols-2 divide-x divide-y divide-slate-200 border-y border-slate-200 bg-white sm:grid-cols-4 sm:divide-y-0">
          <Stat
            label="DOA 报修率"
            value={loading ? "…" : rate(summary?.repairRate ?? null)}
            detail={loading ? "问题批次数量 ÷ 出货数" : (
              <>
                报修数据{" "}
                <Link
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  to={`/doa/repairs?${doaApi.buildQuery(filters)}`}
                >
                  {num(summary?.repairCount ?? 0)}
                </Link>
                {" "}· 问题批次数量 / 出货数
              </>
            )}
            edge="border-emerald-600"
          />
          <Stat
            label="DOA 换件率"
            value={loading ? "…" : rate(summary?.replacementRate ?? null)}
            detail={loading ? "换件不良数量 ÷ 出货数" : (
              <>
                换件不良{" "}
                <Link
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  to={`/doa/repairs?${doaApi.buildQuery(filters, { replacementOnly: "true" })}`}
                >
                  {num(summary?.replacementCount ?? 0)}
                </Link>
                {" "}· 已换件 {num(summary?.replacementRecordCount ?? 0)} 条
              </>
            )}
            edge="border-sky-600"
          />
          <Stat
            label="出货数量"
            value={loading ? "…" : num(summary?.shippedCount ?? 0)}
            detail="按 SAP 实际发货日期统计"
            edge="border-blue-600"
          />
          <Stat
            label="已匹配 DOA"
            value={loading ? "…" : num(summary?.matchedRepairRecords ?? 0)}
            detail={`未匹配 ${num(summary?.excludedRepairRecords ?? 0)} 条`}
            edge="border-amber-500"
          />
        </section>
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
          <div className="min-w-0 border-y border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  报修与换件趋势
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  出货按 SAP 实际发货日期，报修和换件按 DOA 受理日期
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs font-medium">
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <span className="size-2 rounded-sm bg-emerald-600" />
                  报修率
                </span>
                <span className="inline-flex items-center gap-1.5 text-sky-700">
                  <span className="size-2 rounded-sm bg-sky-600" />
                  换件率
                </span>
              </div>
            </div>
            <div className="h-[260px] px-1 pb-2 pt-4 sm:px-4">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  加载中…
                </div>
              ) : !data?.trend.length ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  暂无周期趋势数据
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data.trend}
                    margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
                  >
                    <CartesianGrid
                      stroke="#cbd5e1"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="period"
                      tickFormatter={periodLabel}
                      tick={{ fontSize: 12, fill: "#475569" }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tickFormatter={(value: number) => `${value}%`}
                      tick={{ fontSize: 12, fill: "#475569" }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      domain={[0, "auto"]}
                    />
                    <Tooltip
                      labelFormatter={(label) => `周期 ${label}`}
                      formatter={(value, name) => [
                        value == null ? "—" : `${Number(value).toFixed(2)}%`,
                        name === "repairRate" ? "DOA 报修率" : "DOA 换件率",
                      ]}
                      contentStyle={{
                        borderRadius: 8,
                        borderColor: "#cbd5e1",
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="repairRate"
                      stroke="#047857"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#047857", strokeWidth: 0 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="replacementRate"
                      stroke="#0369a1"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#0369a1", strokeWidth: 0 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="min-w-0 border-y border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
              <h2 className="text-sm font-semibold text-slate-900">
                维度排行
              </h2>
              <div role="group" aria-label="排行维度" className="inline-flex border border-slate-200">
                <button type="button" aria-pressed={rankingDimension === "customer"} onClick={() => setRankingDimension("customer")} className={`h-8 px-3 text-xs font-medium transition-colors ${rankingDimension === "customer" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>客户</button>
                <button type="button" aria-pressed={rankingDimension === "model"} onClick={() => setRankingDimension("model")} className={`h-8 border-l border-slate-200 px-3 text-xs font-medium transition-colors ${rankingDimension === "model" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>机型</button>
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_76px_76px] border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500 sm:px-4">
              <span>{rankingDimension === "customer" ? "客户" : "机型"}</span>
              <span>报修率</span>
              <span>换件率</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {rankingItems.map((item, index) => (
                <div
                  key={item.key}
                  className="grid grid-cols-[minmax(0,1fr)_76px_76px] items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-xs last:border-0 hover:bg-slate-50 sm:px-4"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 font-mono text-[10px] text-slate-400">{index + 1}</span>
                    <span className="truncate font-medium text-slate-700" title={item.key}>{item.key}</span>
                  </span>
                  <span className="font-mono font-semibold text-emerald-700">{rate(item.repairRate)}</span>
                  <span className="font-mono font-semibold text-sky-700">{rate(item.replacementRate)}</span>
                </div>
              ))}
              {!rankingItems.length && (
                <p className="px-3 py-12 text-center text-sm text-slate-500">暂无数据</p>
              )}
            </div>
          </div>
        </section>
        <details className="group border-y border-slate-200 bg-white">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-slate-800 marker:hidden sm:px-4">
            <span>周期明细</span>
            <span className="flex items-center gap-2 text-xs font-normal text-slate-500">
              {num(data?.trend.length ?? 0)} 个周期
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">时间</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">报修服务器数</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">报修率</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">换件不良数量</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">换件率</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">当期出货</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(data?.trend || []).map((item) => (
                  <tr key={item.period} className="transition-colors hover:bg-emerald-50/40">
                    <td className="px-4 py-3 font-medium text-slate-800">{item.period}</td>
                    <td className="px-4 py-3 font-mono">
                      <Link className="text-blue-700 underline-offset-2 hover:underline" to={`/doa/repairs?${doaApi.buildQuery(filtersForPeriod(filters, item.period))}`}>
                        {num(item.repairServerCount)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-emerald-700">{rate(item.repairRate)}</td>
                    <td className="px-4 py-3 font-mono">
                      <Link className="text-blue-700 underline-offset-2 hover:underline" to={`/doa/repairs?${doaApi.buildQuery(filtersForPeriod(filters, item.period), { replacementOnly: "true" })}`}>
                        {num(item.replacementCount)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-sky-700">{rate(item.replacementRate)}</td>
                    <td className="px-4 py-3 font-mono">{num(item.shippedCount)}</td>
                  </tr>
                ))}
                {!data?.trend.length && (
                  <tr><td colSpan={6} className="px-4 py-16 text-center text-sm text-slate-500">暂无周期统计数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
        {summary && summary.excludedRepairRecords > 0 && (
          <p className="text-xs text-slate-600">
            <AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />
            {summary.excludedRepairRecords} 条 DOA 因未匹配 5000
            销售订单或机型未纳入报修率。
          </p>
        )}
      </main>
    </div>
  );
}
