import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface MultiSelectProps {
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
}

export function MultiSelect({ label, options, value, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const available = [...new Set([...value, ...options])];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filtered = available.filter((option) => option.toLocaleLowerCase().includes(normalizedSearch));
  const title = label.replace(/（多选）$/, '');
  const ariaLabel = label.endsWith('（多选）') ? label : `${label}（多选）`;
  const summary = value.length === 0
    ? `全部${title}`
    : value.length === 1 ? value[0] : `${value[0]} 等 ${value.length} 项`;

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <div ref={root} className="relative flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-slate-700">
      <span>{title}</span>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={value.join('、') || undefined}
        onClick={() => { setOpen((current) => !current); setSearch(''); }}
        className={`mt-1 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-white px-2.5 text-left text-sm font-normal outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 ${
          value.length ? 'border-teal-300 text-slate-800' : 'border-slate-300 text-slate-500'
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
          {value.length > 0 && <span>{value.length}</span>}
          <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`选择${title}`}
          className="absolute right-0 top-full z-50 mt-1 w-full min-w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs text-slate-500">已选 {value.length} 项</span>
            <div className="flex items-center gap-3 text-xs">
              <button type="button" onClick={() => onChange([...new Set([...value, ...filtered])])} className="font-medium text-teal-700">全选</button>
              <button type="button" onClick={() => onChange([])} className="font-medium text-slate-500">清空</button>
            </div>
          </div>
          <div className="border-b border-slate-100 p-2">
            <input
              type="search"
              aria-label={`搜索${title}`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`搜索${title}`}
              className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-normal text-slate-700 outline-none focus:border-teal-400 focus:bg-white"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length ? filtered.map((option) => (
              <label key={option} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs font-normal text-slate-700 hover:bg-teal-50">
                <input
                  type="checkbox"
                  checked={value.includes(option)}
                  onChange={() => onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])}
                  className="size-3.5 rounded border-slate-300 accent-teal-700"
                />
                <span className="min-w-0 flex-1 break-all">{option}</span>
              </label>
            )) : (
              <p className="px-3 py-4 text-center text-xs font-normal text-slate-400">
                {available.length ? '没有匹配项' : '暂无可选项目'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
