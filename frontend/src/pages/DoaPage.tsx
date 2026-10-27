import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ChevronDown,
  Clock,
  Download,
  Filter,
  Home,
  Info,
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
import { MultiSelect } from "../components/shared/MultiSelect";
import { useAuth } from "../context/AuthContext";
import { formatLocalDate } from "../utils/dateRange";
import * as XLSX from "xlsx";

function granularityForRange(from: string, to: string): DoaTimeGranularity {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start < 31 * 86400000
    ? "day"
    : "month";
}
function defaultFilters(): DoaFilters {
  const now = new Date();
  const dateFrom = `${now.getFullYear()}-01-01`;
  const dateTo = formatLocalDate(now);
  return {
    dateFrom,
    dateTo,
    customer: "",
    model: "",
    customers: [],
    models: [],
    timeGranularity: granularityForRange(dateFrom, dateTo),
  };
}
function readFilters(params: URLSearchParams): DoaFilters {
  const granularity = params.get("timeGranularity");
  const defaults = defaultFilters();
  const dateFrom = params.get("dateFrom") || defaults.dateFrom;
  const dateTo = params.get("dateTo") || defaults.dateTo;
  return {
    dateFrom,
    dateTo,
    acceptedDateFrom: params.get("acceptedDateFrom") || undefined,
    acceptedDateTo: params.get("acceptedDateTo") || undefined,
    customer: params.get("customer") || "",
    model: params.get("model") || "",
    customers: params.getAll("customers"),
    models: params.getAll("models"),
    timeGranularity:
      granularity === "year" || granularity === "day" || granularity === "month"
        ? granularity : granularityForRange(dateFrom, dateTo),
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
  accent,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  accent: string;
}) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-600">
        <span className={`h-2 w-2 rounded-full ${accent}`} />
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-950 sm:text-2xl">
        {value}
      </p>
      <div className="mt-1 min-h-5 text-xs leading-5 text-slate-500">
        {detail}
      </div>
    </div>
  );
}

export default function DoaPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<DoaFilters>(() => readFilters(params));
  const [options, setOptions] = useState<DoaOptions>({
    customers: [],
    models: [],
  });
  const [data, setData] = useState<DoaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [rankingDimension, setRankingDimension] = useState<
    "customer" | "model"
  >("customer");
  const [rankingMetric, setRankingMetric] = useState<"repairRate" | "replacementRate">("repairRate");
  const [expandedRanking, setExpandedRanking] = useState<{ dimension: "customer" | "model"; key: string } | null>(null);
  const requestId = useRef(0);
  const canExportAudit = user?.role === "admin" || user?.dashboardPermissions?.includes("doa-repairs");
  const load = useCallback(async (next: DoaFilters) => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await doaApi.getDashboard(next);
      if (current === requestId.current) setData(result);
    } catch (err) {
      if (current === requestId.current) {
        setData(null);
        setError(err instanceof Error ? err.message : "DOA 数据加载失败");
      }
    } finally {
      if (current === requestId.current) setLoading(false);
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
  const exportAudit = async () => {
    setExporting(true);
    setExportError("");
    try {
      const audit = await doaApi.getAudit(filters);
      const flat = (row: Record<string, unknown>) => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value != null && typeof value === "object" ? JSON.stringify(value) : value]),
      );
      const workbook = XLSX.utils.book_new();
      const scs = audit.repairs.map(({ raw, ...row }) => flat({ ...raw, ...row }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(scs), "SCS申报");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(audit.orders.map(flat)), "匹配订单原始行");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(audit.changes.map(flat)), "关联换件记录");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ["计算口径", "订单数量代替出货数量，并非实际发货数量"],
        ["时间", "SCS受理日期；同一订单按整个筛选范围去重，各周期内分别去重"],
        ["筛选", filterSummary],
        ["说明", "未匹配申报不参与计算；订单来源字段以 JSON 保存在 sourceFields 列，换件记录为网关流接口字段"],
      ]), "计算说明");
      XLSX.writeFile(workbook, `DOA核对数据_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };
  const exportUnmatchedOrders = () => {
    if (loading || !data?.unmatchedOrders.length) return;
    setExportError("");
    try {
      const rows = data.unmatchedOrders.map((item) => ({
        销售订单: item.salesOrder || "未填写",
        申报条数: item.recordCount,
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "未匹配销售订单");
      XLSX.writeFile(workbook, `DOA未匹配销售订单_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "导出失败");
    }
  };
  const summary = data?.summary;
  const rankingItems = [
    ...(rankingDimension === "customer"
      ? data?.byCustomer || []
      : data?.byModel || []),
  ]
    .sort((a, b) => (b[rankingMetric] ?? -1) - (a[rankingMetric] ?? -1))
    .slice(0, 10);
  const rankingMax = Math.max(0, ...rankingItems.map((item) => item[rankingMetric] ?? 0));
  const filterSummary = [
    `受理 ${filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom || "不限"} 至 ${filters.dateTo || "不限"}`
      : "全部日期"}`,
    ...(filters.acceptedDateFrom || filters.acceptedDateTo
      ? [
          `受理 ${filters.acceptedDateFrom || "不限"} 至 ${filters.acceptedDateTo || "不限"}`,
        ]
      : []),
    (filters.customers?.length ? filters.customers.join("、") : filters.customer) || "全部客户",
    (filters.models?.length ? filters.models.join("、") : filters.model) || "全部机型",
    filters.timeGranularity === "year"
      ? "按年"
      : filters.timeGranularity === "day"
        ? "按日"
        : "按月",
  ].join(" · ");
  return (
    <div className="min-h-screen bg-[#f4f6f5] text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-20 max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
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
              <h1 className="text-lg font-semibold text-slate-950">
                DOA 质量看板
              </h1>
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
          <div className="flex flex-wrap items-center gap-3">
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
      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 sm:px-6 lg:px-8">
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
              <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end">
                <div className="col-span-2 min-w-0 md:w-[300px]">
                  <DateRangePicker
                    label="SCS 受理日期"
                    from={filters.dateFrom}
                    to={filters.dateTo}
                    disabled={loading}
                    onChange={(dateFrom, dateTo) =>
                      apply({ dateFrom, dateTo, timeGranularity: granularityForRange(dateFrom, dateTo) })
                    }
                  />
                </div>
                <div className="min-w-0 md:w-[200px]"><MultiSelect label="客户" options={options.customers} value={filters.customers?.length ? filters.customers : filters.customer ? [filters.customer] : []} onChange={(customers) => apply({ customers, customer: "" })} /></div>
                <div className="min-w-0 md:w-[200px]"><MultiSelect label="机型" options={options.models} value={filters.models?.length ? filters.models : filters.model ? [filters.model] : []} onChange={(models) => apply({ models, model: "" })} /></div>
              </div>
            </div>
          )}
        </section>
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {exportError && <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{exportError}</div>}
        {!error && <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-slate-950">质量概览</h2>
          <p className="text-xs text-slate-500">基于筛选范围内已匹配的 SCS 申报及销售订单</p>
        </div>
        <section aria-label="质量概览指标" className="grid grid-cols-2 divide-x divide-y divide-slate-200 border border-slate-200 bg-white lg:grid-cols-4 lg:divide-y-0">
          <Stat
            label="DOA 报修率"
            value={loading ? "…" : rate(summary?.repairRate ?? null)}
            detail={loading ? "问题批次数量 ÷ 订单数量" : (
              <>
                报修数据{" "}
                <Link
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  to={`/doa/repairs?${doaApi.buildQuery(filters)}`}
                >
                  {num(summary?.repairCount ?? 0)}
                </Link>
                {" "}· 问题批次数量 / 订单数量
              </>
            )}
            accent="bg-emerald-600"
          />
          <Stat
            label="DOA 换件率"
            value={loading ? "…" : rate(summary?.replacementRate ?? null)}
            detail={loading ? "换件不良数量 ÷ 订单数量" : (
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
            accent="bg-sky-600"
          />
          <Stat
            label="匹配订单数量"
            value={loading ? "…" : num(summary?.shippedCount ?? 0)}
            detail="作为出货数量代理值"
            accent="bg-indigo-500"
          />
          <Stat
            label="已匹配 DOA"
            value={loading ? "…" : num(summary?.matchedRepairRecords ?? 0)}
            detail={`未匹配 ${num(summary?.excludedRepairRecords ?? 0)} 条`}
            accent="bg-amber-500"
          />
        </section>
        <div className="relative border border-amber-200 bg-amber-50/70">
        <details className="group">
          <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-2 py-3 pl-4 pr-36 text-sm text-amber-950 marker:hidden">
            <AlertTriangle className="size-4 shrink-0 text-amber-700" />
            <span className="font-semibold">未匹配销售订单：{loading ? "…" : num(data?.unmatchedOrders?.length ?? 0)} 个，{loading ? "…" : num(summary?.excludedRepairRecords ?? 0)} 条申报</span>
            <span className="text-xs text-amber-800">不参与指标计算</span>
            <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="max-h-60 overflow-auto border-t border-amber-200">
            <table className="w-full text-left text-sm"><thead><tr><th className="px-4 py-2">销售订单</th><th className="px-4 py-2">申报条数</th></tr></thead><tbody>
              {(data?.unmatchedOrders ?? []).map((item) => <tr key={item.salesOrder} className="border-t border-amber-100"><td className="px-4 py-2">{item.salesOrder || "未填写"}</td><td className="px-4 py-2">{num(item.recordCount)}</td></tr>)}
              {!loading && !data?.unmatchedOrders.length && <tr><td colSpan={2} className="px-4 py-4 text-xs text-amber-800">当前没有未匹配订单</td></tr>}
            </tbody></table>
          </div>
          <p className="px-4 py-2 text-xs text-amber-800">未匹配记录没有订单客户或机型，列表不受这两个筛选条件影响。</p>
        </details>
          <button type="button" onClick={exportUnmatchedOrders} disabled={loading || !data?.unmatchedOrders.length} className="absolute right-3 top-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
            <Download className="size-4" />导出未匹配订单
          </button>
        </div>
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
          <div className="min-w-0 border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  <BarChart3 className="mr-2 inline size-4 text-emerald-700" />报修与换件趋势
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  按 DOA 受理日期统计，订单数量在各周期内去重
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
            <div className="h-[300px] px-1 pb-2 pt-4 sm:px-4">
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
                    margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
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
                      width={55}
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
          <div className="min-w-0 border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
              <h2 className="text-sm font-semibold text-slate-900">
                维度排行
              </h2>
              <div role="group" aria-label="排行维度" className="inline-flex border border-slate-200">
                <button type="button" aria-pressed={rankingDimension === "customer"} onClick={() => setRankingDimension("customer")} className={`h-8 px-3 text-xs font-medium transition-colors ${rankingDimension === "customer" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>客户</button>
                <button type="button" aria-pressed={rankingDimension === "model"} onClick={() => setRankingDimension("model")} className={`h-8 border-l border-slate-200 px-3 text-xs font-medium transition-colors ${rankingDimension === "model" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>机型</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4">
              <span className="text-xs text-slate-500">前 10 项 · 按所选指标降序</span>
              <div role="group" aria-label="排行指标" className="inline-flex rounded border border-slate-200 text-xs">
                <button type="button" aria-pressed={rankingMetric === "repairRate"} onClick={() => setRankingMetric("repairRate")} className={`px-2.5 py-1 ${rankingMetric === "repairRate" ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>报修率</button>
                <button type="button" aria-pressed={rankingMetric === "replacementRate"} onClick={() => setRankingMetric("replacementRate")} className={`border-l border-slate-200 px-2.5 py-1 ${rankingMetric === "replacementRate" ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>换件率</button>
              </div>
            </div>
            <div className="max-h-[310px] overflow-y-auto" aria-busy={loading}>
              {!loading && rankingItems.map((item, index) => {
                const expanded = expandedRanking?.dimension === rankingDimension && expandedRanking.key === item.key;
                const detailFilters = rankingDimension === "customer"
                  ? { ...filters, customer: "", customers: [item.key] }
                  : { ...filters, model: "", models: [item.key] };
                return (
                <div
                  key={item.key}
                  className="border-b border-slate-100 text-xs last:border-0"
                >
                  <button type="button" aria-expanded={expanded} aria-label={`${item.key || "未填写"} ${expanded ? "收起" : "查看"}详情`} onClick={() => setExpandedRanking(expanded ? null : { dimension: rankingDimension, key: item.key })} className="block w-full px-3 py-2.5 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600 sm:px-4">
                  <span className="flex items-center gap-2">
                    <span className="w-4 shrink-0 font-mono text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-800" title={item.key}>{item.key || "未填写"}</span>
                    <span className="font-mono font-semibold tabular-nums text-slate-900">{rate(item[rankingMetric])}</span>
                    <ChevronDown aria-hidden="true" className={`size-3.5 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </span>
                  <span className="ml-6 mt-1.5 flex items-center gap-3">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                      <span className={`block h-full rounded-full ${rankingMetric === "repairRate" ? "bg-emerald-600" : "bg-sky-600"}`} style={{ width: `${rankingMax > 0 ? Math.max(0, (item[rankingMetric] ?? 0) / rankingMax * 100) : 0}%` }} />
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-500">订单 {num(item.shippedCount)}</span>
                  </span>
                  </button>
                  {expanded && <div className="space-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-slate-600">
                      <div><dt>问题批次数量</dt><dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{num(item.repairCount)}</dd></div>
                      <div><dt>报修率</dt><dd className="mt-0.5 font-semibold tabular-nums text-emerald-700">{rate(item.repairRate)}</dd></div>
                      <div><dt>换件不良数量</dt><dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{num(item.replacementCount)}</dd></div>
                      <div><dt>换件率</dt><dd className="mt-0.5 font-semibold tabular-nums text-sky-700">{rate(item.replacementRate)}</dd></div>
                    </dl>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200 pt-2">
                      <Link className="font-medium text-blue-700 hover:underline" to={`/doa/repairs?${doaApi.buildQuery(detailFilters)}`}>报修明细 <ArrowRight className="inline size-3" /></Link>
                      <Link className="font-medium text-blue-700 hover:underline" to={`/doa/repairs?${doaApi.buildQuery(detailFilters, { replacementOnly: "true" })}`}>换件明细 <ArrowRight className="inline size-3" /></Link>
                    </div>
                  </div>}
                </div>
              );})}
              {loading ? <p className="px-3 py-12 text-center text-sm text-slate-500">加载中…</p> : !rankingItems.length && (
                <p className="px-3 py-12 text-center text-sm text-slate-500">暂无数据</p>
              )}
            </div>
          </div>
        </section>
        <section className="border border-slate-200 bg-white">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 sm:px-4">
            <div><h2 className="text-sm font-semibold text-slate-900">周期明细</h2><p className="mt-1 text-xs text-slate-500">各周期订单独立去重，点击数量查看明细</p></div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-500">{loading ? "加载中…" : `${num(data?.trend.length ?? 0)} 个周期`}</span>
              {canExportAudit && <button type="button" onClick={exportAudit} disabled={exporting || loading} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download className="size-4" />{exporting ? "导出中…" : "导出核对数据"}</button>}
            </div>
          </div>
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">时间</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">报修服务器数</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">报修率</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">换件不良数量</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">换件率</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-700">当期订单数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {!loading && (data?.trend || []).map((item) => (
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
                {loading ? <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">加载中…</td></tr> : !data?.trend.length && (
                  <tr><td colSpan={6} className="px-4 py-16 text-center text-sm text-slate-500">暂无周期统计数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <details className="group border border-slate-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-700 marker:hidden">
            <Info className="size-4 text-slate-500" />计算口径
            <span className="text-xs font-normal text-slate-500">订单数量为出货数量代理值</span>
            <ChevronDown className="ml-auto size-4 text-slate-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600">
            <p>SCS 5000 公司且判定为“是”的申报，按销售订单号关联订单看板；订单数量代替出货数量，并非实际发货数量。报修率为问题批次数量 ÷ 匹配订单数量，换件率为有效换件的问题批次数量 ÷ 匹配订单数量。未匹配订单不参与计算。</p>
            <p>按受理日期统计；同一销售订单的多条订单行数量相加，同一订单在筛选范围内只计一次，趋势中每个周期分别去重，周期合计可能大于总体。客户、机型不唯一时归为未填写；其他客户或机型筛选不会纳入此类记录。</p>
            <Link to="/doa/raw" className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline">查看 SCS 原始数据 <ArrowRight className="size-3" /></Link>
          </div>
        </details>
        </>}
      </main>
    </div>
  );
}
