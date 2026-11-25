import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { doaApi } from '../api/doaApi';
import type { DoaFilters, DoaOrdersResponse } from '../types/doa';
import { HelpTooltip } from '../components/shared/HelpTooltip';

export default function DoaOrdersPage() {
  const [params] = useSearchParams();
  const query = params.toString();
  const g = params.get('timeGranularity');
  const filters: DoaFilters = {
    dateFrom: params.get('dateFrom') || '', dateTo: params.get('dateTo') || '',
    acceptedDateFrom: params.get('acceptedDateFrom') || undefined,
    acceptedDateTo: params.get('acceptedDateTo') || undefined,
    customer: params.get('customer') || '', model: params.get('model') || '',
    customerId: params.get('customerId') || '',
    customers: params.getAll('customers'), customerIds: params.getAll('customerIds'), models: params.getAll('models'),
    timeGranularity: g === 'year' || g === 'day' ? g : 'month',
  };
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DoaOrdersResponse | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let active = true;
    setError(''); setData(null);
    doaApi.getOrders(filters, page, 50).then(result => { if (active) setData(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '订单加载失败'); });
    return () => { active = false; };
  }, [query, page]);
  const exportRows = async () => {
    setExporting(true); setError('');
    try {
      const rows = await doaApi.getAllOrders(filters);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.map(row => ({
        销售订单: row.salesOrder, 交货单号: row.deliveryNumber, 交货行项目: row.deliveryItem, 物料号: row.materialNumber, 客户: row.customer,
        客户ID: row.customerId,
        机型: row.model, 实际发货日期: row.shipmentDate, 出货数量: row.quantity,
      }))), '到货数据');
      XLSX.writeFile(workbook, `DOA订单明细_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导出失败'); }
    finally { setExporting(false); }
  };
  return <div className="min-h-screen bg-slate-50 text-slate-800">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4">
      <div className="flex items-center gap-3"><Link to={`/doa?${query}`} aria-label="返回 DOA 看板" className="text-slate-500 hover:text-blue-600"><ArrowLeft className="size-5" /></Link><div><div className="flex items-center gap-1"><h1 className="font-semibold">DOA 到货数据明细</h1><HelpTooltip label="查看到货数据明细计算说明">按 SAP 发货日期 WADAT、客户及机型筛选 5000 公司交付批次，每批仅汇总一次 LFIMG。</HelpTooltip></div><p className="text-xs text-slate-500">交付批次 {data?.total.toLocaleString() ?? '—'} 条，数量 {data?.totalQuantity.toLocaleString() ?? '—'}；日期为实际发货日期</p></div></div>
      <button type="button" disabled={exporting || !data} onClick={exportRows} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"><Download className="size-4" />{exporting ? '导出中…' : '导出 Excel'}</button>
    </div></header>
    <main className="mx-auto max-w-7xl px-4 py-5">{error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}<div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="w-full min-w-[750px] text-left text-sm"><thead className="bg-slate-50"><tr>{['销售订单', '交货单号', '行项目', '物料号', '客户', '机型', '实际发货日期', '出货数量'].map(x => <th key={x} className="px-4 py-3 font-medium">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data?.items.map((item, index) => <tr key={`${item.deliveryNumber}-${index}`}><td className="px-4 py-3">{item.salesOrder}</td><td className="px-4 py-3">{item.deliveryNumber || '—'}</td><td className="px-4 py-3">{item.deliveryItem || '—'}</td><td className="px-4 py-3">{item.materialNumber || '—'}</td><td className="px-4 py-3">{item.customer || '—'}</td><td className="px-4 py-3">{item.model || '—'}</td><td className="px-4 py-3">{item.shipmentDate || '—'}</td><td className="px-4 py-3">{item.quantity.toLocaleString()}</td></tr>)}</tbody></table>
      {!data && !error && <p className="p-8 text-center text-sm text-slate-500">加载中…</p>}{data?.total === 0 && <p className="p-8 text-center text-sm text-slate-500">暂无交付批次</p>}
    </div><div className="mt-3 flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">上一页</button><span>第 {page} 页</span><button type="button" disabled={!data || page * 50 >= data.total} onClick={() => setPage(page + 1)} className="disabled:opacity-40">下一页</button></div></main>
  </div>;
}
