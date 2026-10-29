import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';

export type CycleFilterOption = {
  value: string;
  label?: string;
};

/** 与销售订单看板一致的可搜索多选下拉控件。 */
export function CycleMultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
  multiple = true,
}: {
  label: string;
  placeholder: string;
  options: CycleFilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)
        && !menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const anchor = containerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const width = Math.min(288, Math.max(0, window.innerWidth - 16));
      const height = Math.min(menu.offsetHeight, Math.max(0, window.innerHeight - 16));
      menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - height - 8))}px`;
    };
    positionMenu();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionMenu);
    if (menuRef.current) observer?.observe(menuRef.current);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => (option.label || option.value).toLocaleLowerCase().includes(normalizedQuery))
    : options;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => {
            if (!current) setQuery('');
            return !current;
          });
        }}
        className={`flex h-9 min-w-40 items-center justify-between gap-2 rounded-md border bg-white px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          selected.length > 0 ? 'border-blue-400 text-slate-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'
        }`}
      >
        <span className="truncate">{selected.length > 0 ? `${label} (${selected.length})` : placeholder}</span>
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div ref={menuRef} role="dialog" aria-label={`选择${label}`} className="fixed z-[100] max-h-[calc(100vh-1rem)] w-[min(18rem,calc(100vw-1rem))] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium text-slate-500">{label}</span>
            <div className="flex items-center gap-3 text-xs">
              {multiple && (
                <button type="button" onClick={() => onChange([...new Set([...selected, ...options.map((option) => option.value)])])} className="font-medium text-blue-600 hover:text-blue-700">
                  全选
                </button>
              )}
              <button type="button" onClick={() => onChange([])} className="font-medium text-slate-500 hover:text-slate-700">
                清空
              </button>
            </div>
          </div>
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`搜索${label}…`}
                className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {options.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">暂无可选项目</p>
            ) : filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">无匹配“{query.trim()}”的项目</p>
            ) : (
              filteredOptions.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-blue-50/60">
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    checked={selected.includes(option.value)}
                    onChange={() => onChange(multiple ? (selected.includes(option.value) ? selected.filter((value) => value !== option.value) : [...selected, option.value]) : [option.value])}
                    className="size-3.5 rounded border-slate-300 accent-blue-600"
                  />
                  <span className="truncate font-mono text-xs">{option.label || option.value}</span>
                </label>
              ))
            )}
          </div>
        </div>, document.body
      )}
    </div>
  );
}
