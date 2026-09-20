import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

type MonthQuickPickerMode = 'date' | 'month';
type MonthQuickPickerAccent = 'blue' | 'cyan' | 'emerald' | 'rose';

interface MonthQuickPickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  mode?: MonthQuickPickerMode;
  accent?: MonthQuickPickerAccent;
  defaultExpanded?: boolean;
  className?: string;
}

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const accentClasses: Record<MonthQuickPickerAccent, { active: string; idle: string; toggle: string }> = {
  blue: {
    active: 'border-blue-600 bg-blue-50 font-semibold text-blue-800',
    idle: 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700',
    toggle: 'text-blue-700 hover:text-blue-800',
  },
  cyan: {
    active: 'border-cyan-600 bg-cyan-50 font-semibold text-cyan-800',
    idle: 'border-slate-200 bg-white text-slate-500 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700',
    toggle: 'text-cyan-700 hover:text-cyan-800',
  },
  emerald: {
    active: 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-800',
    idle: 'border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700',
    toggle: 'text-emerald-700 hover:text-emerald-800',
  },
  rose: {
    active: 'border-rose-600 bg-rose-50 font-semibold text-rose-800',
    idle: 'border-slate-200 bg-white text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700',
    toggle: 'text-rose-700 hover:text-rose-800',
  },
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function selectedMonth(from: string, to: string, mode: MonthQuickPickerMode): string | null {
  if (!from || !to) return null;
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  if (fromMonth !== toMonth) return null;
  if (mode === 'month') return from === to ? fromMonth : null;

  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  const expectedFrom = `${fromMonth}-01`;
  const expectedTo = `${toMonth}-${daysInMonth(year, month)}`;
  return from === expectedFrom && to === expectedTo ? fromMonth : null;
}

export function MonthQuickPicker({
  from,
  to,
  onChange,
  mode = 'date',
  accent = 'cyan',
  defaultExpanded = true,
  className = '',
}: MonthQuickPickerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const year = Number((from || to).slice(0, 4)) || new Date().getFullYear();
  const selected = selectedMonth(from, to, mode);
  const colors = accentClasses[accent];

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-500">{year} 年快捷月份</span>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'}月份快捷筛选`}
          className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors ${colors.toggle}`}
        >
          {expanded ? '收起月份' : '展开月份'}
          {expanded ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
        </button>
      </div>
      {expanded && (
        <div className="mt-1.5 grid grid-cols-6 gap-1 sm:grid-cols-12">
          {MONTHS.map((month) => {
            const key = monthKey(year, month);
            const isSelected = selected === key;
            const nextFrom = mode === 'month' ? key : `${key}-01`;
            const nextTo = mode === 'month' ? key : `${key}-${daysInMonth(year, month)}`;
            return (
              <button
                key={month}
                type="button"
                onClick={() => onChange(nextFrom, nextTo)}
                aria-pressed={isSelected}
                className={`h-7 rounded border text-xs transition-colors ${isSelected ? colors.active : colors.idle}`}
              >
                {month}月
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
