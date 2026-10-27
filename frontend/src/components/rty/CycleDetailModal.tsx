import { useEffect, useRef, useState } from 'react';
import { Download, FileSearch, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtyApi } from '../../api/rtyApi';
import type { RTYCycleDetailQuery, RTYCycleDetails } from '../../types/rty';
import { REPAIR_DETAIL_COLUMNS } from './repairDetailColumns';

type CycleDetailTab = 'orders' | 'faults';

interface CycleDetailModalProps {
  title: string;
  query: RTYCycleDetailQuery;
  inputCount: number;
  defectCount: number;
  onClose: () => void;
}

const ORDER_COLUMNS = [
  ['VBELN', '销售订单'],
  ['AUFNR', '生产订单'],
  ['MAKTX_TH', '生产机型'],
  ['KID', '客户ID'],
  ['NAME1_ZU', '最终用户'],
  ['LGORT', '基地'],
  ['GSTRS', '计划开始时间'],
  ['WMENG', '订单产量'],
  ['AUART', '订单类型'],
] as const;

function safeCell(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export default function CycleDetailModal({
  title,
  query,
  inputCount,
  defectCount,
  onClose,
}: CycleDetailModalProps) {
  const [data, setData] = useState<RTYCycleDetails>({ orders: [], faults: [] });
  const [tab, setTab] = useState<CycleDetailTab>('orders');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestId = useRef(0);
  const columns = tab === 'orders' ? ORDER_COLUMNS : REPAIR_DETAIL_COLUMNS;
  const rows = tab === 'orders' ? data.orders : data.faults;
  const rtyRate = inputCount ? ((inputCount - defectCount) / inputCount) * 100 : null;

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    void rtyApi.getCycleDetails(query).then((result) => {
      if (currentRequest === requestId.current) setData(result);
    }).catch((loadError: unknown) => {
      if (currentRequest === requestId.current) {
        setError(loadError instanceof Error ? loadError.message : '明细加载失败，请重试');
      }
    }).finally(() => {
      if (currentRequest === requestId.current) setLoading(false);
    });
    return () => { requestId.current += 1; };
  }, [query]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const exportRows = () => {
    if (exporting || loading || rows.length === 0) return;
    setExporting(true);
    try {
      const worksheet = XLSX.utils.aoa_to_sheet([
        columns.map(([, label]) => label),
        ...rows.map(row => columns.map(([key]) => safeCell(row[key]))),
      ]);
      worksheet['!autofilter'] = { ref: worksheet['!ref'] || 'A1' };
      worksheet['!cols'] = columns.map(([, label]) => ({
        wch: Math.min(36, Math.max(14, label.length * 1.5)),
      }));
      const workbook = XLSX.utils.book_new();
      const sheetName = tab === 'orders' ? '订单明细' : '维修明细';
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      XLSX.writeFile(workbook, `${title}_${sheetName}_${query.dateFrom}_${query.dateTo}.xlsx`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '明细导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-3 sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cycle-detail-title"
        className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-start gap-2.5">
            <FileSearch className="mt-0.5 size-4 shrink-0 text-cyan-700" />
            <div className="min-w-0">
              <h2 id="cycle-detail-title" className="truncate text-sm font-semibold text-slate-900">{title}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {query.dateFrom} 至 {query.dateTo}
                <span className="mx-2 text-slate-300">|</span>
                {query.orderScope === 'normal' ? '普通订单' : 'L6订单'}
                <span className="mx-2 text-slate-300">|</span>
                产量 {inputCount.toLocaleString('zh-CN')} · 故障 {defectCount.toLocaleString('zh-CN')} · RTY {rtyRate === null ? '-' : `${rtyRate.toFixed(2)}%`}
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"
            title="关闭明细"
            aria-label="关闭明细"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 sm:px-5">
          <div role="tablist" aria-label="周期统计明细类型" className="inline-flex rounded-sm border border-slate-200 p-0.5">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'orders'}
              onClick={() => setTab('orders')}
              className={`rounded-sm px-3 py-1.5 text-xs font-medium ${tab === 'orders' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              订单 / 产量
              <span className="ml-1.5 tabular-nums opacity-75">{data.orders.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'faults'}
              onClick={() => setTab('faults')}
              className={`rounded-sm px-3 py-1.5 text-xs font-medium ${tab === 'faults' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              维修记录
              <span className="ml-1.5 tabular-nums opacity-75">{data.faults.length}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={exportRows}
            disabled={loading || exporting || rows.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
            title={`导出${tab === 'orders' ? '订单 / 产量' : '维修记录'}明细`}
          >
            <Download className="size-3.5" />
            {exporting ? '导出中...' : `导出${tab === 'orders' ? '订单' : '维修记录'}`}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
          {error && <p role="alert" className="mb-3 text-xs text-red-700">{error}</p>}
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">正在加载明细...</div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">暂无明细数据</div>
          ) : (
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>{columns.map(([key, label]) => <th key={key} className="px-3 py-2 font-semibold">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {rows.map((row, index) => (
                  <tr key={`${String(row.AUFNR || '')}:${String(row.PCODE || '')}:${index}`} className="hover:bg-slate-50">
                    {columns.map(([key]) => (
                      <td key={key} className="max-w-64 px-3 py-2" title={String(row[key] ?? '')}>
                        {row[key] === null || row[key] === undefined || row[key] === '' ? '-' : String(row[key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
          当前列表 {rows.length.toLocaleString('zh-CN')} 条
        </footer>
      </section>
    </div>
  );
}
