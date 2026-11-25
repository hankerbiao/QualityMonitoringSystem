import { useEffect, useId, useRef, useState } from 'react';
import { Download, Search, X } from 'lucide-react';
import { mfrApi } from '../api/mfrApi';
import type { MFRExport, MFRFaultDetail, MFRFilters } from '../types/mfr';

export type MFRDetailSelection = { period: string } | 'date-issues';

const PAGE_SIZE = 50;
const deviceIdentity = (row: MFRFaultDetail) => row.deviceSn || row.deviceKey;

function faultsForPeriod(rows: MFRFaultDetail[], period: string) {
  const monthRows = rows.filter(row => row.faultDate.slice(0, 7) === period.slice(0, 7));
  if (period.length === 7) return monthRows;

  // Unfiltered monthly records determine the date bucket used by the daily chart.
  const firstDates = new Map<string, string>();
  for (const row of monthRows) {
    const identity = deviceIdentity(row);
    if (!identity) continue;
    const first = firstDates.get(identity);
    if (!first || row.faultDate < first) firstDates.set(identity, row.faultDate);
  }
  return monthRows.filter(row => {
    const identity = deviceIdentity(row);
    return (identity ? firstDates.get(identity) : row.faultDate) === period;
  });
}

interface Props {
  filters: MFRFilters;
  selection: MFRDetailSelection;
  onClose: () => void;
  onExportFaults: (rows: MFRFaultDetail[], period: string, filters: MFRFilters) => void;
}

export default function MFRDetailDialog({ filters, selection, onClose, onExportFaults }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [result, setResult] = useState<MFRExport | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [exportError, setExportError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [model, setModel] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const modal = dialog.current;
    if (modal && !modal.open) modal.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    mfrApi.getExport(filters).then(data => {
      if (active) setResult(data);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : '明细加载失败');
    });
    return () => { active = false; };
  }, [filters, retry]);

  const period = selection === 'date-issues' ? '' : selection.period;
  const faultRows = period && result ? faultsForPeriod(result.faultDetails, period) : [];
  const models = [...new Set(faultRows.map(row => row.model).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const term = keyword.trim().toLowerCase();
  const visibleFaults = faultRows.filter(row =>
    (!model || row.model === model) && (!term || [row.deviceSn, row.deviceKey, row.serviceOrder, row.doaCode, row.partNumber]
      .some(value => value?.toLowerCase().includes(term))),
  );
  const deviceCount = new Set(visibleFaults.map(deviceIdentity).filter(Boolean)).size;
  const dateIssues = result?.changeIssueDetails?.filter(row => row.reason === 'faultDateUnresolved') ?? [];
  const total = period ? visibleFaults.length : dateIssues.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const loading = !result && !error;

  const exportRows = () => {
    if (!result || !visibleFaults.length) return;
    setExportError('');
    try {
      onExportFaults(visibleFaults, period, result.filters);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '明细导出失败');
    }
  };

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby={titleId}
      className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-5xl overflow-auto rounded-md border border-slate-200 bg-white p-0 text-slate-800 shadow-xl backdrop:bg-slate-900/40">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-slate-950">{period ? `${period} 故障明细` : 'DOA 申报日期异常'}</h2>
          <p className="mt-1 text-xs text-slate-600">统计区间 {filters.dateFrom} 至 {filters.dateTo}</p>
        </div>
        <button type="button" aria-label="关闭明细" onClick={() => dialog.current?.close()}
          className="rounded-md p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {loading && <p role="status" className="px-4 py-10 text-center text-sm text-slate-600">正在加载明细…</p>}
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 px-4 py-5 text-sm text-red-700">
        <p>{error}</p>
        <button type="button" className="underline" onClick={() => { setError(''); setRetry(value => value + 1); }}>重试</button>
      </div>}
      {result && <>
        {period && <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <label className="flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-md border border-slate-300 px-2.5 focus-within:border-indigo-600">
            <Search className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
            <input type="search" aria-label="搜索故障明细" placeholder="搜索 SN、服务单号、DOA 单号或物料编码" value={keyword}
              onChange={event => { setKeyword(event.target.value); setPage(1); setExportError(''); }}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
          <select aria-label="机型" value={model} onChange={event => { setModel(event.target.value); setPage(1); setExportError(''); }}
            className="h-9 max-w-52 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-2 focus-visible:outline-indigo-600">
            <option value="">全部机型</option>
            {models.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="button" onClick={exportRows} disabled={!visibleFaults.length}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-indigo-700 px-3 text-sm text-white hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50">
            <Download className="size-4" aria-hidden="true" />导出筛选结果
          </button>
        </div>}
        {exportError && <p role="alert" className="px-4 pt-2 text-sm text-red-700">{exportError}</p>}
        <p role="status" className="px-4 py-2 text-xs font-medium text-slate-700">
          {period ? `${deviceCount} 台故障整机 · ${total} 条换件记录` : `${total} 条日期异常记录`}
        </p>
        {period.length > 7 && <p className="px-4 pb-2 text-xs text-slate-600">按当月首次有效故障日选中设备，展示这些设备在统计区间内的换件记录。</p>}
        {total ? <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="明细表格">
          {period ? <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-slate-50 text-slate-600"><tr>
              {['故障日期', '设备 SN / 标识', '机型', '服务单号', 'DOA 申报单号', '物料编码', '换件类型'].map(label => <th key={label} scope="col" className="px-4 py-2">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleFaults.slice(pageStart, pageEnd).map((row, index) => <tr key={`${row.changeId}-${pageStart + index}`}>
                {[row.faultDate, deviceIdentity(row), row.model, row.serviceOrder, row.doaCode, row.partNumber, row.changeType]
                  .map((value, column) => <td key={column} className="px-4 py-2">{value || '—'}</td>)}
              </tr>)}
            </tbody>
          </table> : <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="bg-slate-50 text-slate-600"><tr>
              {['设备 SN / 标识', '服务单号', 'DOA 申报单号', '换件记录 ID', '换件时间', '物料编码'].map(label => <th key={label} scope="col" className="px-4 py-2">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {dateIssues.slice(pageStart, pageEnd).map((row, index) => <tr key={`${row.changeId}-${pageStart + index}`}>
                {[row.deviceSn || row.deviceKey, row.serviceOrder, row.doaCodes.join('、'), row.changeId, row.occurredAt, row.partNumber]
                  .map((value, column) => <td key={column} className="px-4 py-2">{value || '—'}</td>)}
              </tr>)}
            </tbody>
          </table>}
        </div> : <p className="px-4 py-10 text-center text-sm text-slate-600">
          {keyword || model ? '没有符合筛选条件的记录' : '暂无明细记录'}
        </p>}
        {totalPages > 1 && <nav aria-label="明细分页" className="flex items-center justify-end gap-3 border-t border-slate-200 px-4 py-2 text-xs">
          <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded border border-slate-300 px-2.5 py-1.5 disabled:opacity-40">上一页</button>
          <span>{page} / {totalPages}</span>
          <button type="button" disabled={page === totalPages} onClick={() => setPage(page + 1)} className="rounded border border-slate-300 px-2.5 py-1.5 disabled:opacity-40">下一页</button>
        </nav>}
      </>}
    </dialog>
  );
}
