import { Fragment, useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtyApi } from '../../api/rtyApi';
import type { RepairQualityDetailQuery, RepairQualityDetails } from '../../types/rty';

export function RepairQualityDetailDialog({ query, expectedCount, denominator, onClose }: {
  query: RepairQualityDetailQuery;
  expectedCount: number;
  denominator?: number;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RepairQualityDetails | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls[controls.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previous?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    setExpanded(null);
    rtyApi.getRepairQualityDetails(query, page).then(result => {
      if (active) setData(result);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : '明细加载失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [query, page, retry]);

  const exportDetails = async () => {
    setExporting(true);
    setExportError('');
    try {
      const result = await rtyApi.getRepairQualityDetails(query, 1, true);
      if (data && result.total !== data.total) throw new Error('数据已变化，请关闭明细并重新查询看板');
      const rows = result.items.flatMap(item => item.repairs.map(repair => ({
        SN: item.sn, 维修次数: item.repairCount, 机型: item.models.join('、'),
        生产订单: repair.productionOrder, 销售订单: repair.salesOrder,
        不良工位: repair.station, 故障代码: repair.faultCode, 故障描述: repair.description,
        发现日期: repair.foundDate, 维修日期: repair.repairDate, 维修人员: repair.repairPerson,
      })));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '维修明细');
      XLSX.writeFile(workbook, `维修明细_${query.dateFrom}_${query.dateTo}.xlsx`);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const bucketLabel = query.bucket === 'all' ? '全部维修 SN' : query.bucket === '9+' ? '维修 9 次及以上' : `维修 ${query.bucket} 次`;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="repair-detail-title" className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-md bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 id="repair-detail-title" className="text-base font-semibold text-slate-900">维修 SN 明细</h2>
            <p className="mt-1 break-words text-xs text-slate-600">{query.customer} / {query.base} · {bucketLabel} · {query.dateFrom} 至 {query.dateTo}</p>
            {denominator != null && <p className="mt-1 text-xs text-slate-600">看板首修通过率：{expectedCount} / {denominator} = {(expectedCount / denominator * 100).toFixed(2)}%</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭明细" title="关闭" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-5" /></button>
        </header>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 text-sm">
          <span>{loading ? '正在加载...' : `共 ${data?.total ?? 0} 个 SN`}</span>
          <button type="button" disabled={loading || !data?.total || exporting} onClick={exportDetails} className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download className="size-4" />{exporting ? '导出中' : '导出明细'}</button>
        </div>
        {data && data.total !== expectedCount && <p role="alert" className="bg-amber-50 px-4 py-2 text-xs text-amber-800">数据已变化：看板显示 {expectedCount} 个 SN，当前明细为 {data.total} 个，请重新查询看板核对。</p>}
        {exportError && <p role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-700">导出失败：{exportError}</p>}
        <div className="min-h-40 overflow-auto">
          {error ? <div role="alert" className="px-4 py-6 text-center text-sm text-red-700">{error} <button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 underline">重试</button></div>
            : loading ? <p className="px-4 py-8 text-center text-sm text-slate-500">正在加载维修明细</p>
              : !data?.items.length ? <p className="px-4 py-8 text-center text-sm text-slate-500">暂无维修明细</p>
                : <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-4 py-2">SN</th><th className="px-4 py-2">生产订单</th><th className="px-4 py-2">机型</th><th className="px-4 py-2">维修次数</th><th className="px-4 py-2"><span className="sr-only">维修记录</span></th></tr></thead>
                  <tbody>{data.items.map(item => <Fragment key={item.sn}>
                    <tr className="border-t border-slate-200"><td className="px-4 py-2 font-medium">{item.sn}</td><td className="px-4 py-2">{item.productionOrders.join('、') || '—'}</td><td className="px-4 py-2">{item.models.join('、') || '—'}</td><td className="px-4 py-2">{item.repairCount}</td><td className="px-4 py-2"><button type="button" aria-expanded={expanded === item.sn} aria-label={`${expanded === item.sn ? '收起' : '展开'} ${item.sn} 维修记录`} onClick={() => setExpanded(expanded === item.sn ? null : item.sn)} className="rounded p-1 text-teal-700 hover:bg-teal-50"><ChevronDown className={`size-4 ${expanded === item.sn ? 'rotate-180' : ''}`} /></button></td></tr>
                    {expanded === item.sn && <tr><td colSpan={5} className="bg-slate-50 px-4 py-3"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead><tr className="text-slate-500">{['生产订单', '销售订单', '不良工位', '故障代码', '故障描述', '发现日期', '维修日期', '维修人员'].map(label => <th key={label} className="px-2 py-1">{label}</th>)}</tr></thead><tbody>{item.repairs.map((row, index) => <tr key={index} className="border-t border-slate-200">{[row.productionOrder, row.salesOrder, row.station, row.faultCode, row.description, row.foundDate, row.repairDate, row.repairPerson].map((value, field) => <td key={field} className="px-2 py-2">{value || '—'}</td>)}</tr>)}</tbody></table></div></td></tr>}
                  </Fragment>)}</tbody>
                </table>}
        </div>
        <footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
          <button type="button" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)} className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40">上一页</button>
          <span>第 {page} / {pageCount} 页</span>
          <button type="button" disabled={loading || !data || page >= pageCount} onClick={() => setPage(value => value + 1)} className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40">下一页</button>
        </footer>
      </div>
    </div>
  );
}
