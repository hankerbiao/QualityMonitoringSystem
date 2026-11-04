import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { rtyApi } from '../../api/rtyApi';
import type { ExcludedOrder, RTYFilterParams } from '../../types';

const PAGE_SIZE = 50;

interface ExcludedOrdersModalProps {
  filters: RTYFilterParams;
  onClose: () => void;
}

export function ExcludedOrdersModal({ filters, onClose }: ExcludedOrdersModalProps) {
  const [items, setItems] = useState<ExcludedOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void rtyApi.getExcludedOrders(filters, page, PAGE_SIZE)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setItems([]);
        setTotal(0);
        setError(requestError instanceof Error ? requestError.message : '已过滤订单加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filters, page]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="excluded-orders-title">
      <div className="flex max-h-[85vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="excluded-orders-title" className="text-base font-semibold text-slate-800">已过滤订单</h2>
              {!loading && <span className="rounded-sm bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{total} 条</span>}
            </div>
            <p className="mt-1 text-xs text-slate-600">过滤条件：订单状态为 DLID、RELEASED，或订单类型为 C001。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-sm p-1 text-slate-500 transition-colors hover:bg-slate-100" title="关闭" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 font-semibold">计划日期</th>
                <th className="px-4 py-3 font-semibold">销售订单</th>
                <th className="px-4 py-3 font-semibold">生产订单</th>
                <th className="px-4 py-3 font-semibold">生产机型</th>
                <th className="px-4 py-3 font-semibold">基地</th>
                <th className="px-4 py-3 font-semibold">订单状态</th>
                <th className="px-4 py-3 font-semibold">订单类型</th>
                <th className="px-4 py-3 font-semibold">排除原因</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">正在加载数据...</td></tr>
              ) : error ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-red-600">{error}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">当前筛选条件下没有已过滤订单</td></tr>
              ) : items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{item.time || '-'}</td>
                  <td className="px-4 py-3 font-mono">{item.salesOrder || '-'}</td>
                  <td className="px-4 py-3 font-mono">{item.productionOrder}</td>
                  <td className="px-4 py-3">{item.productModel || '-'}</td>
                  <td className="px-4 py-3">{item.base || '-'}</td>
                  <td className="px-4 py-3">{item.orderStatus || '-'}</td>
                  <td className="px-4 py-3">{item.orderType || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.exclusionReasons.map((reason) => <span key={reason} className="rounded-sm border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">{reason}</span>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && !error && total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2">
            <span className="text-xs text-slate-500">第 {page}/{totalPages} 页</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPage(current => current - 1)} disabled={page === 1} className="rounded-sm p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" title="上一页" aria-label="上一页">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setPage(current => current + 1)} disabled={page === totalPages} className="rounded-sm p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" title="下一页" aria-label="下一页">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
