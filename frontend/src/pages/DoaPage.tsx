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
import { readDoaCache, readDoaOptionsCache, writeDoaCache, writeDoaOptionsCache } from "../api/doaCache";
import type {
  DoaDashboard,
  DoaFilters,
  DoaOptions,
  DoaTimeGranularity,
} from "../types/doa";
import { DashboardSwitcher } from "../components/shared/DashboardSwitcher";
import { DashboardLoading } from "../components/shared/DashboardLoading";
import { HelpTooltip } from "../components/shared/HelpTooltip";
import { DateRangePicker } from "../components/shared/DateRangePicker";
import { MultiSelect } from "../components/shared/MultiSelect";
import { buildDoaWorkbook } from "../components/doa/exportData";
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
  const dateFrom = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const dateTo = formatLocalDate(now);
  return {
    dateFrom,
    dateTo,
    customer: "",
    customerId: "",
    model: "",
    customers: [],
    customerIds: [],
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
    customerId: params.get("customerId") || "",
    model: params.get("model") || "",
    customers: params.getAll("customers"),
    customerIds: params.getAll("customerIds"),
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
  help,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  accent: string;
  help?: ReactNode;
}) {
  return (
    <div className="min-w-0 px-3 py-2 sm:px-4">
      <p className="flex items-center gap-1 text-xs font-semibold text-slate-600">
        <span className={`h-2 w-2 rounded-full ${accent}`} />
        {label}
        {help && <HelpTooltip label={`查看${label}说明`}>{help}</HelpTooltip>}
      </p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-950 sm:text-2xl">
        {value}
      </p>
      <div className="mt-0.5 min-h-4 text-xs leading-4 text-slate-500">
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
    customerIds: [],
  });
  const [data, setData] = useState<DoaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [unmatchedExpanded, setUnmatchedExpanded] = useState(false);
  const [rankingDimension, setRankingDimension] = useState<
    "customer" | "model"
  >("customer");
  const [rankingMetric, setRankingMetric] = useState<"repairRate" | "replacementRate">("repairRate");
  const [expandedRanking, setExpandedRanking] = useState<{ dimension: "customer" | "model"; key: string } | null>(null);
  const requestId = useRef(0);
  const reportExportInProgress = useRef(false);
  const canExportAudit = user?.role === "admin" || user?.dashboardPermissions?.includes("doa-repairs");
  const cacheScope = user?.username || user?.itcode
    ? JSON.stringify([user.username || user.itcode, user.role, user.basePermissions?.slice().sort() ?? null, user.dashboardPermissions?.slice().sort() ?? []])
    : "";
  const load = useCallback(async (next: DoaFilters) => {
    const current = ++requestId.current;
    const cached = readDoaCache(cacheScope, next);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await doaApi.getDashboard(next);
      if (current === requestId.current) {
        writeDoaCache(cacheScope, next, result);
        setData(result);
      }
    } catch (err) {
      if (current === requestId.current) {
        setData(null);
        setError(err instanceof Error ? err.message : "DOA 数据加载失败");
      }
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [cacheScope]);
  useEffect(() => {
    let active = true;
    const cachedOptions = readDoaOptionsCache(cacheScope);
    if (cachedOptions) setOptions(cachedOptions);
    else doaApi.getOptions().then(result => {
      if (active) {
        writeDoaOptionsCache(cacheScope, result);
        setOptions(result);
      }
    }).catch(() => undefined);
    load(filters);
    return () => { active = false; };
  }, [load, cacheScope]);
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
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(audit.orders.map(flat)), "分母订单原始行");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(audit.changes.map(flat)), "关联换件记录");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ["计算口径", "订单数量代替出货数量，并非实际发货数量"],
        ["时间", "报修和订单均按生产订单计划开始日期 GSTRS；未匹配日期的报修单独展示"],
        ["筛选", filterSummary],
        ["说明", "有唯一计划日期的有效申报计入；未匹配日期单独列示；订单来源字段保存在 sourceFields 列"],
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
  const exportReport = async () => {
    if (!data || loading || reportExportInProgress.current) return;
    reportExportInProgress.current = true;
    setReportExporting(true);
    setExportError("");
    try {
      const [orders, details] = await Promise.all([
        doaApi.getAllOrders(filters),
        canExportAudit ? Promise.all([
          doaApi.getAllRepairs(filters),
          doaApi.getAllRepairs(filters, true),
          doaApi.getAllRepairs(filters, false, 1000, true),
        ]).then(([repairs, replacements, unmatchedDates]) => ({ repairs, replacements, unmatchedDates })) : Promise.resolve(null),
      ]);
      const sameTotal = (a: number, b: number) => Math.abs(a - b) < 0.00001;
      const totalRepairs = (items: { repairCount: number }[]) => items.reduce((total, item) => total + item.repairCount, 0);
      if (!sameTotal(orders.reduce((total, item) => total + item.quantity, 0), data.summary.shippedCount)
        || (details && (!sameTotal(totalRepairs(details.repairs), data.summary.repairCount)
          || !sameTotal(totalRepairs(details.replacements), data.summary.replacementCount)
          || details.unmatchedDates.length !== data.summary.unmatchedPlannedRecords
          || !sameTotal(totalRepairs(details.unmatchedDates), data.summary.unmatchedPlannedQuantity)))) {
        throw new Error("看板与明细数据已发生变化，请稍后重试或重新登录后再导出");
      }
      XLSX.writeFile(buildDoaWorkbook(data, filters, orders, details), `DOA质量报表_${formatLocalDate(new Date())}.xlsx`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "导出失败，请重试");
    } finally {
      reportExportInProgress.current = false;
      setReportExporting(false);
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
    `日期 ${filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom || "不限"} 至 ${filters.dateTo || "不限"}`
      : "全部日期"}`,
    ...(filters.acceptedDateFrom || filters.acceptedDateTo
      ? [
          `受理 ${filters.acceptedDateFrom || "不限"} 至 ${filters.acceptedDateTo || "不限"}`,
        ]
      : []),
    (filters.customers?.length ? filters.customers.join("、") : filters.customer) || "全部客户",
    (filters.customerIds?.length ? filters.customerIds.join("、") : filters.customerId) || "全部客户ID",
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
        <div className="mx-auto flex min-h-14 max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
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
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                <span className="text-slate-600">5000 公司销售订单 · SCS 判定结果</span>
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                  <Clock className="size-3" aria-hidden="true" />
                  数据更新至 {formatDateTime(summary?.latestDataAt)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void exportReport()}
              disabled={loading || !data || reportExporting}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="size-4" aria-hidden="true" />
              {reportExporting ? "导出中…" : "导出 Excel"}
            </button>
            {!loading && !error && data && (
              <button
                type="button"
                aria-expanded={unmatchedExpanded}
                aria-controls={unmatchedExpanded ? "doa-unmatched-data" : undefined}
                onClick={() => setUnmatchedExpanded((expanded) => !expanded)}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
              >
                <AlertTriangle className="size-4" aria-hidden="true" />
                未匹配数据
                <ChevronDown className={`size-4 transition-transform ${unmatchedExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            )}
            <DashboardSwitcher />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-2.5 px-4 py-3 sm:px-6 lg:px-8">
        <section className="border-y border-slate-200 bg-white">
          <div className="flex min-h-10 items-center justify-between gap-3 px-3 sm:px-4">
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
              className="border-t border-slate-100 px-3 py-2 sm:px-4"
            >
              <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end">
                <div className="col-span-2 min-w-0 md:w-[300px]">
                  <DateRangePicker
                    label="生产订单计划开始日期"
                    from={filters.dateFrom}
                    to={filters.dateTo}
                    disabled={loading}
                    onChange={(dateFrom, dateTo) =>
                      apply({ dateFrom, dateTo, timeGranularity: granularityForRange(dateFrom, dateTo) })
                    }
                  />
                </div>
                <div className="min-w-0 md:w-[200px]"><MultiSelect label="客户" options={options.customers} value={filters.customers?.length ? filters.customers : filters.customer ? [filters.customer] : []} onChange={(customers) => apply({ customers, customer: "" })} /></div>
                <div className="min-w-0 md:w-[200px]"><MultiSelect label="客户ID" options={options.customerIds ?? []} value={filters.customerIds?.length ? filters.customerIds : filters.customerId ? [filters.customerId] : []} onChange={(customerIds) => apply({ customerIds, customerId: "" })} /></div>
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
        {!error && (loading ? <DashboardLoading dashboard="DOA" /> : <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-slate-950">质量概览</h2>
          <HelpTooltip label="查看 DOA 质量概览说明">订单和报修均按生产订单计划开始日期 GSTRS 筛选。有效报修为 5000 公司中判定结果为“是”、非待受理且问题批次数量非空的申报。无法确定计划日期的报修单独展示，不计入当前报修率。</HelpTooltip>
        </div>
        <section aria-label="质量概览指标" className="grid grid-cols-2 divide-x divide-y divide-slate-200 border border-slate-200 bg-white lg:grid-cols-4 lg:divide-y-0">
          <Stat
            label="DOA 报修率"
            value={loading ? "…" : rate(summary?.repairRate ?? null)}
            detail={loading ? "加载中" : (
              <>
                报修数据{" "}
                <Link
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  to={`/doa/repairs?${doaApi.buildQuery(filters)}`}
                >
                  {num(summary?.repairCount ?? 0)}
                </Link>
              </>
            )}
            help="DOA 报修率 = 有效报修的问题批次数量之和 ÷ 所选条件下订单计划数量之和 × 100%。问题批次数量为空的申报不计入；计划数量为 0 时显示“—”。"
            accent="bg-emerald-600"
          />
          <Stat
            label="DOA 换件率"
            value={loading ? "…" : rate(summary?.replacementRate ?? null)}
            detail={loading ? "加载中" : (
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
            help="DOA 换件率 = 有有效换件记录的报修问题批次数量之和 ÷ 订单计划数量之和 × 100%。有效换件指同一服务单中未撤销的“换上”或“换上-up”记录；同一报修不因多条换件记录重复计数。"
            accent="bg-sky-600"
          />
          <Stat
            label="到货数据（计划数量）"
            value={loading ? "…" : <Link className="text-blue-700 hover:underline" to={`/doa/orders?${doaApi.buildQuery(filters)}`}>{num(summary?.shippedCount ?? 0)}</Link>}
            detail=""
            accent="bg-indigo-500"
            help="到货数据为符合所选日期、客户和机型条件的 5000 公司销售订单计划数量之和，日期使用生产订单计划开始日期 GSTRS；该数量不是实际发货量。"
          />
          <Stat
            label="已匹配 DOA"
            value={loading ? "…" : num(summary?.matchedRepairRecords ?? 0)}
            detail=""
            accent="bg-amber-500"
            help="有效报修中，销售订单号能在订单数据中找到对应订单的申报条数；这是记录条数，不是问题批次数量。未匹配销售订单的有效报修仍计入报修数量。"
          />
        </section>
        {unmatchedExpanded && <section id="doa-unmatched-data" aria-label="未匹配数据" className="border border-amber-200 bg-amber-50/70 text-sm text-amber-950">
          <div className="flex items-center gap-2 border-b border-amber-200 px-4 py-2 font-semibold">
            <AlertTriangle className="size-4 shrink-0 text-amber-700" />未匹配数据
          </div>
          <div className="grid divide-y divide-amber-200/70 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            <div className="flex min-w-0 flex-col items-start gap-1 px-4 py-2">
              <p>无法确定生产订单计划日期的报修 {num(summary?.unmatchedPlannedRecords ?? 0)} 条，问题批次数量 {num(summary?.unmatchedPlannedQuantity ?? 0)}；<span className="text-amber-800">不受日期筛选，不计入当前报修率。</span></p>
              {(summary?.unmatchedPlannedRecords ?? 0) > 0 && <Link className="shrink-0 font-medium text-blue-700 underline" to={`/doa/repairs?${doaApi.buildQuery(filters, { unmatchedOnly: "true" })}`}>查看未匹配日期明细</Link>}
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1 px-4 py-2">
              <p>无法归属机型的有效报修，问题批次数量 {num(data?.byModel.find(item => item.key === "未匹配机型")?.repairCount ?? 0)}。</p>
              {data?.byModel.some(item => item.key === "未匹配机型") && <Link className="shrink-0 font-medium text-blue-700 underline" to={`/doa/repairs?${doaApi.buildQuery({ ...filters, model: "", models: ["未匹配机型"] })}`}>查看未匹配机型明细</Link>}
            </div>
            <div>
              <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-2">
                <details className="group min-w-0 flex-1">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 marker:hidden">
                    <span className="font-semibold">未匹配销售订单：{num(data?.unmatchedOrders?.length ?? 0)} 个，{num(summary?.unmatchedRepairRecords ?? 0)} 条申报</span>
                    <span className="text-xs text-amber-800">已计入总报修数</span>
                    <HelpTooltip label="查看未匹配订单说明">未匹配订单的客户单独列示，机型按 SCS 产品字段匹配。</HelpTooltip>
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-3 max-h-60 overflow-auto border-t border-amber-200">
                    <table className="w-full text-left text-sm"><thead><tr><th className="px-4 py-2">销售订单</th><th className="px-4 py-2">申报条数</th></tr></thead><tbody>
                      {(data?.unmatchedOrders ?? []).map((item) => <tr key={item.salesOrder} className="border-t border-amber-100"><td className="px-4 py-2">{item.salesOrder || "未填写"}</td><td className="px-4 py-2">{num(item.recordCount)}</td></tr>)}
                      {!data?.unmatchedOrders.length && <tr><td colSpan={2} className="px-4 py-4 text-xs text-amber-800">当前没有未匹配订单</td></tr>}
                    </tbody></table>
                  </div>
                </details>
                <button type="button" onClick={exportUnmatchedOrders} disabled={loading || !data?.unmatchedOrders.length} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
                  <Download className="size-4" />导出未匹配订单
                </button>
              </div>
            </div>
          </div>
        </section>}
        <section className="grid gap-2.5 lg:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
          <div className="min-w-0 border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 sm:px-4">
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold text-slate-900">
                  <BarChart3 className="mr-2 inline size-4 text-emerald-700" />报修与换件趋势
                </h2>
                <HelpTooltip label="查看报修与换件趋势说明">按生产订单计划开始日期 GSTRS 将有效报修和订单归入日、月或年周期。每期报修率 = 当期报修问题批次数量 ÷ 当期订单计划数量 × 100%；换件率使用当期有效换件报修的问题批次数量作为分子。计划数量为 0 时不显示比率，未匹配计划日期的报修不计入趋势。</HelpTooltip>
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
            <div className="h-[240px] px-1 pb-2 pt-2 sm:px-4">
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 sm:px-4">
              <div className="flex items-center gap-1"><h2 className="text-sm font-semibold text-slate-900">维度排行</h2>
                <HelpTooltip label="查看客户与机型排行说明">按客户或机型分别汇总有效报修、换件数量和订单计划数量，再计算报修率或换件率。按所选比率降序显示前 10 项，计划数量为 0 时比率显示“—”。机型依据 SCS 产品名称匹配，无法匹配的归为“未匹配机型”；客户无法匹配的单独列示。</HelpTooltip>
              </div>
              <div role="group" aria-label="排行维度" className="inline-flex border border-slate-200">
                <button type="button" aria-pressed={rankingDimension === "customer"} onClick={() => setRankingDimension("customer")} className={`h-8 px-3 text-xs font-medium transition-colors ${rankingDimension === "customer" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>客户</button>
                <button type="button" aria-pressed={rankingDimension === "model"} onClick={() => setRankingDimension("model")} className={`h-8 border-l border-slate-200 px-3 text-xs font-medium transition-colors ${rankingDimension === "model" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>机型</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1 sm:px-4">
              <span className="text-xs text-slate-500">按所选指标排序</span>
              <div role="group" aria-label="排行指标" className="inline-flex rounded border border-slate-200 text-xs">
                <button type="button" aria-pressed={rankingMetric === "repairRate"} onClick={() => setRankingMetric("repairRate")} className={`px-2.5 py-1 ${rankingMetric === "repairRate" ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>报修率</button>
                <button type="button" aria-pressed={rankingMetric === "replacementRate"} onClick={() => setRankingMetric("replacementRate")} className={`border-l border-slate-200 px-2.5 py-1 ${rankingMetric === "replacementRate" ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>换件率</button>
              </div>
            </div>
            <div className="max-h-[240px] overflow-y-auto" aria-busy={loading}>
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
                  <button type="button" aria-expanded={expanded} aria-label={`${item.key || "未填写"} ${expanded ? "收起" : "查看"}详情`} onClick={() => setExpandedRanking(expanded ? null : { dimension: rankingDimension, key: item.key })} className="block w-full px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600 sm:px-4">
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
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 sm:px-4">
            <div className="flex items-center gap-1"><h2 className="text-sm font-semibold text-slate-900">周期明细</h2><HelpTooltip label="查看周期明细说明">
              <p>按生产订单计划开始日期 GSTRS 分日、月或年汇总；当期订单数量为订单计划数量之和，计划数量不是实际发货量。</p>
              <p className="mt-1">报修服务器数为当期有效报修的非空序列号去重数；报修率和换件率分别以问题批次数量、有效换件报修的问题批次数量为分子，除以当期计划数量，再乘以 100%。</p>
              <p className="mt-1">有效报修需判定结果为“是”、非待受理且问题批次数量非空。未匹配计划日期不计入；机型按 SCS 产品名称匹配，无法确定的单独归类。</p>
            </HelpTooltip></div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-500">{loading ? "加载中…" : `${num(data?.trend.length ?? 0)} 个周期`}</span>
              {canExportAudit && <button type="button" onClick={exportAudit} disabled={exporting || loading} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download className="size-4" />{exporting ? "导出中…" : "导出核对数据"}</button>}
            </div>
          </div>
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-2 text-xs font-semibold text-slate-700">时间</th>
                  <th className="px-4 py-2 text-xs font-semibold text-slate-700">报修服务器数</th>
                  <th className="px-4 py-2 text-xs font-semibold text-slate-700">报修率</th>
                  <th className="px-4 py-2 text-xs font-semibold text-slate-700">换件不良数量</th>
                  <th className="px-4 py-2 text-xs font-semibold text-slate-700">换件率</th>
                  <th className="px-4 py-2 text-xs font-semibold text-slate-700">当期订单数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {!loading && (data?.trend || []).map((item) => (
                  <tr key={item.period} className="transition-colors hover:bg-emerald-50/40">
                    <td className="px-4 py-2 font-medium text-slate-800">{item.period}</td>
                    <td className="px-4 py-2 font-mono">
                      <Link className="text-blue-700 underline-offset-2 hover:underline" to={`/doa/repairs?${doaApi.buildQuery(filtersForPeriod(filters, item.period))}`}>
                        {num(item.repairServerCount)}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono font-semibold text-emerald-700">{rate(item.repairRate)}</td>
                    <td className="px-4 py-2 font-mono">
                      <Link className="text-blue-700 underline-offset-2 hover:underline" to={`/doa/repairs?${doaApi.buildQuery(filtersForPeriod(filters, item.period), { replacementOnly: "true" })}`}>
                        {num(item.replacementCount)}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono font-semibold text-sky-700">{rate(item.replacementRate)}</td>
                    <td className="px-4 py-2 font-mono"><Link className="text-blue-700 hover:underline" to={`/doa/orders?${doaApi.buildQuery(filtersForPeriod(filters, item.period))}`}>{num(item.shippedCount)}</Link></td>
                  </tr>
                ))}
                {loading ? <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">加载中…</td></tr> : !data?.trend.length && (
                  <tr><td colSpan={6} className="px-4 py-16 text-center text-sm text-slate-500">暂无周期统计数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        </>)}
      </main>
    </div>
  );
}
