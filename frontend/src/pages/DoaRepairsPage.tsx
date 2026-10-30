import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, FileSearch, X } from "lucide-react";
import * as XLSX from "xlsx";
import { doaApi } from "../api/doaApi";
import { HelpTooltip } from "../components/shared/HelpTooltip";
import type { DoaFilters, DoaRepairItem } from "../types/doa";

function filtersFrom(params: URLSearchParams): DoaFilters {
  const g = params.get("timeGranularity");
  return {
    dateFrom: params.get("dateFrom") || "",
    dateTo: params.get("dateTo") || "",
    acceptedDateFrom: params.get("acceptedDateFrom") || undefined,
    acceptedDateTo: params.get("acceptedDateTo") || undefined,
    customer: params.get("customer") || "",
    customerId: params.get("customerId") || "",
    model: params.get("model") || "",
    customers: params.getAll("customers"),
    customerIds: params.getAll("customerIds"),
    models: params.getAll("models"),
    timeGranularity: g === "year" || g === "day" ? g : "month",
  };
}
function value(v: unknown) {
  return v == null || v === ""
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
}
function dashboardQuery(filters: DoaFilters) {
  return doaApi.buildQuery({
    ...filters,
    acceptedDateFrom: undefined,
    acceptedDateTo: undefined,
  });
}

export default function DoaRepairsPage() {
  const [params] = useSearchParams();
  const filters = filtersFrom(params);
  const replacementOnly = params.get("replacementOnly") === "true";
  const unmatchedOnly = params.get("unmatchedOnly") === "true";
  const [items, setItems] = useState<DoaRepairItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalRepairCount, setTotalRepairCount] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DoaRepairItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const limit = 50;
  useEffect(() => {
    setLoading(true);
    doaApi
      .getRepairs(filters, page, limit, replacementOnly, unmatchedOnly)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setTotalRepairCount(
          Number.isFinite(r.totalRepairCount) ? r.totalRepairCount : null,
        );
      })
      .finally(() => setLoading(false));
  }, [page, replacementOnly, params.toString()]);
  const exportRows = async () => {
    setExporting(true);
    setExportError("");
    try {
      const items = await doaApi.getAllRepairs(filters, replacementOnly, 1000, unmatchedOnly);
      const rows = items.map((item) => ({
        ...item.data,
        销售订单: item.salesOrder,
        序列号: item.materialSerial,
        受理日期: item.acceptedAt,
        生产订单计划日期: item.plannedAt,
        计划日期匹配状态: item.gstrsStatus,
        客户: item.customer,
        客户ID: item.customerId,
        机型: item.model,
        订单计划开始日期: item.shippedDate,
        匹配订单数量: item.shippedCount,
        问题批次数量: item.repairCount,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        ws,
        replacementOnly ? "DOA换件明细" : "DOA报修明细",
      );
      XLSX.writeFile(
        wb,
        `${replacementOnly ? "DOA换件明细" : "DOA报修明细"}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "导出失败，请重试");
    } finally {
      setExporting(false);
    }
  };
  const pageTitle = unmatchedOnly ? "DOA 未匹配计划日期明细（不受日期筛选）" : replacementOnly ? "DOA 换件不良明细" : "DOA 报修明细";
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              to={`/doa?${dashboardQuery(filters)}`}
              aria-label="返回 DOA 看板"
              className="text-slate-500 hover:text-blue-600"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <div>
              <div className="flex items-center gap-1"><p className="text-lg font-semibold text-slate-950">{pageTitle}</p>
                <HelpTooltip label="查看报修明细计算说明">
                  <p>有效报修为 5000 公司中判定结果为“是”、非待受理且问题批次数量非空的申报；条数为申报记录数，问题批次数量为各条数量之和。</p>
                  <p className="mt-1">{unmatchedOnly ? "无法确定生产订单计划日期的申报不受日期筛选，不计入当前报修率；仍受客户、机型筛选。" : "按生产订单计划开始日期 GSTRS、客户和机型筛选；无法确定计划日期的申报单独展示，不计入当前报修率。"}</p>
                  {replacementOnly && <p className="mt-1">换件明细仅包括同一服务单有未撤销“换上”或“换上-up”记录的有效报修，每条报修只计一次。</p>}
                </HelpTooltip>
              </div>
              <p className="text-xs text-slate-400">
                当前筛选命中 {total.toLocaleString()} 条，问题批次数量{" "}
                {totalRepairCount?.toLocaleString() ?? "—"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={exportRows}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Download className="size-4" />
            {exporting ? "导出中…" : "导出 Excel"}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {exportError && <p role="alert" className="mb-3 text-sm text-red-700">{exportError}</p>}
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
            <FileSearch className="size-4 text-blue-600" />
            {replacementOnly ? "已换件 DOA 不良数据" : "合格 DOA 报修数据"}
          </div>
          {loading ? (
            <div className="px-4 py-16 text-center text-sm text-slate-400">
              加载中…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-400">
                  <tr>
                    {[
                      "销售订单",
                      "序列号",
                      "受理日期",
                      "生产订单计划日期",
                      "客户",
                      "机型",
                      "订单计划开始日期",
                      "问题批次数量",
                    ].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelected(item)}
                      className="cursor-pointer text-slate-600 hover:bg-blue-50/40"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-blue-600">
                        {value(item.salesOrder)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {value(item.materialSerial)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {value(item.acceptedAt)}
                      </td>
                      <td className="px-4 py-3 text-xs">{value(item.plannedAt)}</td>
                      <td className="max-w-[220px] truncate px-4 py-3">
                        {value(item.customer)}
                      </td>
                      <td className="px-4 py-3">{value(item.model)}</td>
                      <td className="px-4 py-3 text-xs">
                        {value(item.shippedDate)}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {item.repairCount}
                      </td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-16 text-center text-sm text-slate-400"
                      >
                        暂无{replacementOnly ? "换件" : "报修"}数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>
              第 {page} / {Math.max(1, Math.ceil(total / limit))} 页
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={page * limit >= total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      </main>
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-md bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-800">
                DOA 记录详情 · {selected.salesOrder}
              </h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="关闭"
                className="text-slate-500"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(selected.data).map(([k, v]) => (
                    <tr key={k}>
                      <th className="w-48 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                        {k}
                      </th>
                      <td className="break-all px-3 py-2 font-mono text-xs text-slate-700">
                        {value(v)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
