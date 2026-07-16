import { useEffect, useState, useCallback } from 'react';
import { X, Search, Loader2, ChevronLeft, ChevronRight, AlertCircle, Wrench, ChevronDown, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { apiFetch } from '../api/authApi';
import { API_BASE_URL } from '../constants';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface FaultGroup {
  sale_no: string;
  fault_count: number;
  faults: Record<string, unknown>[];
}

interface FaultGroupData {
  groups: FaultGroup[];
  total: number;
  total_faults: number;
  page: number;
  page_size: number;
}

interface FaultListModalProps {
  onClose: () => void;
}

const PAGE_SIZE = 10;

function FaultRow({ fault }: { fault: Record<string, unknown> }) {
  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
      <td className="px-4 py-2 font-mono text-xs text-blue-600 whitespace-nowrap">
        {String(fault.sn ?? '')}
      </td>
      <td className="px-4 py-2">
        {fault.fault_category ? (
          <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
            {String(fault.fault_category)}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-xs max-w-[200px] truncate" title={String(fault.fault_desc ?? '')}>
        {String(fault.fault_desc ?? '') || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-2 text-xs">{String(fault.product_name ?? '') || <span className="text-slate-300">—</span>}</td>
      <td className="px-4 py-2 text-xs">{String(fault.product_family ?? '') || <span className="text-slate-300">—</span>}</td>
      <td className="px-4 py-2 text-xs">{String(fault.sn ?? '')}</td>
      <td className="px-4 py-2 font-mono text-xs">{String(fault.mfg_order ?? '') || <span className="text-slate-300">—</span>}</td>
      <td className="px-4 py-2 text-xs">{String(fault.repair_person ?? '') || <span className="text-slate-300">—</span>}</td>
      <td className="px-4 py-2 text-xs text-slate-500">{String(fault.repair_time ?? '') || <span className="text-slate-300">—</span>}</td>
    </tr>
  );
}

export default function FaultListModal({ onClose }: FaultListModalProps) {
  const [data, setData] = useState<FaultGroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (kw: string, pg: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(pg), page_size: String(PAGE_SIZE) });
      if (kw) params.set('search', kw);
      const res = await apiFetch(`${API_BASE_URL}/faults?${params.toString()}`);
      const json: ApiResponse<FaultGroupData> = await res.json();
      if (!json.success) throw new Error(json.message || '加载失败');
      setData(json.data);
      // 默认展开所有组
      setExpanded(new Set(json.data.groups.map((g) => g.sale_no)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(search, page);
  }, [page, load, search]);

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load(search, 1);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggleGroup = (saleNo: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(saleNo)) next.delete(saleNo);
      else next.add(saleNo);
      return next;
    });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 shrink-0">
          <div>
            <div className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-red-500" />
              故障信息 · 按销售订单分组
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {data
                ? `共 ${data.total} 个订单含故障 · ${data.total_faults.toLocaleString()} 条故障记录`
                : '加载中...'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 SN / 故障描述 / 分类 / 物料名…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </div>
        </div>

        {/* 列表主体 */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中…
            </div>
          )}
          {error && !loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4" />
              加载失败：{error}
            </div>
          )}
          {!loading && !error && data && (
            <div className="divide-y divide-slate-200">
              {data.groups.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-sm">
                  暂无故障数据
                </div>
              ) : (
                data.groups.map((group) => {
                  const isOpen = expanded.has(group.sale_no);
                  return (
                    <div key={group.sale_no}>
                      {/* 组标题 — 可点击展开/收起 */}
                      <button
                        onClick={() => toggleGroup(group.sale_no)}
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors text-left"
                      >
                        {isOpen ? (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRightIcon className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <code className="text-sm font-semibold text-blue-700">{group.sale_no}</code>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
                          <Wrench className="w-3 h-3" />
                          {group.fault_count} 条故障
                        </span>
                        <span className="text-xs text-slate-400 ml-auto">
                          {isOpen ? '点击收起' : '点击展开'}
                        </span>
                      </button>

                      {/* 故障列表表格 */}
                      {isOpen && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="bg-slate-50 text-slate-500 font-medium">
                                <th className="px-4 py-2">SN</th>
                                <th className="px-4 py-2">故障分类</th>
                                <th className="px-4 py-2">故障描述</th>
                                <th className="px-4 py-2">物料名</th>
                                <th className="px-4 py-2">机型</th>
                                <th className="px-4 py-2">工单号</th>
                                <th className="px-4 py-2">维修人</th>
                                <th className="px-4 py-2">维修时间</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 text-slate-600">
                              {group.faults.map((fault, i) => (
                                <FaultRow key={`${fault.sn}-${i}`} fault={fault} />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* 分页 */}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-200 text-xs text-slate-500 shrink-0">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              上一页
            </button>
            <span>
              第 {page} / {totalPages} 页 · 共 {data.total} 个订单含故障
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              下一页
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
