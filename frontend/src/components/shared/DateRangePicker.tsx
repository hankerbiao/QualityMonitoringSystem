import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { dateRangePresets, type DateRange } from '../../utils/dateRange';
import { MonthQuickPicker } from './MonthQuickPicker';

interface DateRangePickerProps extends DateRange {
  label: string;
  disabled?: boolean;
  onChange: (from: string, to: string) => void;
}

export function DateRangePicker({ label, from, to, disabled = false, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>({ from, to });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const presets = dateRangePresets();
  const selected = presets.find(item => item.from === from && item.to === to);
  const valid = Boolean(draft.from && draft.to && draft.from <= draft.to);

  useEffect(() => {
    if (!open) return;
    startInput.current?.focus();
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const commit = (value: DateRange) => {
    onChange(value.from, value.to);
    setOpen(false);
    trigger.current?.focus();
  };
  const cancel = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div ref={root} className="relative flex min-w-0 basis-full flex-col gap-1 sm:min-w-64 sm:flex-[1.3]">
      <span id={`${id}-label`} className="text-[11px] font-medium text-slate-600">{label}</span>
      <button ref={trigger} type="button" disabled={disabled} aria-labelledby={`${id}-label`} aria-haspopup="dialog"
        aria-expanded={open && !disabled} aria-controls={open && !disabled ? `${id}-dialog` : undefined}
        title={`${from} 至 ${to}`} onClick={() => { setDraft({ from, to }); setOpen(value => !value); }}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 outline-none hover:border-teal-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:opacity-50">
        <CalendarDays className="size-4 shrink-0 text-teal-700" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left tabular-nums">{from} <span className="px-0.5 text-slate-400">至</span> {to}</span>
        {selected && <span className="shrink-0 text-[10px] text-teal-700">{selected.label}</span>}
        <ChevronDown className={`size-3.5 shrink-0 text-slate-400 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && !disabled && <div id={`${id}-dialog`} role="dialog" aria-label="选择日期范围"
        className="absolute left-0 top-full z-50 mt-1 w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white shadow-lg"
        onKeyDown={event => {
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            if (valid) commit(draft);
          }
        }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-xs font-semibold text-slate-800">{label}</span>
          <button type="button" onClick={cancel} aria-label="关闭日期选择器" title="关闭日期选择器" className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-3.5" /></button>
        </div>
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-5 gap-1.5" aria-label="日期快捷筛选">
            {presets.map(item => <button key={item.label} type="button" onClick={() => commit(item)}
              aria-pressed={item.from === from && item.to === to}
              className={`h-8 rounded border px-1 text-[11px] transition-colors ${item.from === from && item.to === to ? 'border-teal-500 bg-teal-50 font-semibold text-teal-800' : 'border-slate-200 text-slate-600 hover:border-teal-300 hover:bg-teal-50'}`}>
              {item.label}
            </button>)}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
            <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-500">开始日期
              <input ref={startInput} type="date" value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))}
                className="h-9 min-w-0 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-500">结束日期
              <input type="date" value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))}
                className="h-9 min-w-0 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
            </label>
          </div>
          {!valid && <p role="alert" className="text-[11px] text-red-700">{!draft.from || !draft.to ? '请选择完整的起止日期' : '开始日期不能晚于结束日期'}</p>}
          <MonthQuickPicker from={draft.from} to={draft.to} onChange={(nextFrom, nextTo) => setDraft({ from: nextFrom, to: nextTo })} accent="emerald" defaultExpanded={false} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-3 py-2">
          <button type="button" onClick={cancel} className="h-8 rounded-md border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50">取消</button>
          <button type="button" disabled={!valid} onClick={() => commit(draft)} className="h-8 rounded-md bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">确定</button>
        </div>
      </div>}
    </div>
  );
}
