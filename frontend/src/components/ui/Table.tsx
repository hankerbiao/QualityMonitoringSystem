import type { ReactNode } from 'react';

interface TableColumn<T> {
  key: string;
  label: string;
  render?: (item: T) => ReactNode;
  className?: string;
}

interface TableProps<T extends { id: string }> {
  columns: TableColumn<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  renderSummary?: (data: T[]) => ReactNode;
  emptyText?: string;
}

export function Table<T extends { id: string }>({
  columns,
  data,
  onRowClick,
  renderSummary,
  emptyText = '暂无数据',
}: TableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="border border-slate-200 rounded-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f8fafc] border-b border-slate-200">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={`px-4 py-2 font-medium text-slate-700 ${col.className || ''}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
        </table>
        <div className="text-center text-slate-500 py-10">{emptyText}</div>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-sm overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="bg-[#f8fafc] border-b border-slate-200">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`px-4 py-2 font-medium text-slate-700 ${col.className || ''}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {data.map((item, idx) => (
            <tr
              key={`${item.id}-${idx}`}
              className={onRowClick ? 'hover:bg-slate-50 cursor-pointer' : 'hover:bg-slate-50'}
              onClick={() => onRowClick?.(item)}
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-2.5 ${col.className || ''}`}>
                  {col.render ? col.render(item) : (item as Record<string, unknown>)[col.key] as ReactNode}
                </td>
              ))}
            </tr>
          ))}
          {renderSummary && (
            <tr className="bg-[#f8fafc] font-semibold border-t border-slate-200">
              {renderSummary(data)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}