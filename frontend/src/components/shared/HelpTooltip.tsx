import { useId, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

type HelpTooltipProps = {
  children: ReactNode;
  label?: string;
  align?: 'start' | 'end';
};

export function HelpTooltip({ children, label = '查看说明', align = 'start' }: HelpTooltipProps) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;

  return (
    <span
      className="relative inline-flex shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="inline-flex size-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-50 mt-1.5 max-h-[min(70vh,28rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-slate-200 bg-white px-3 py-2.5 text-left text-xs font-normal leading-5 text-slate-600 shadow-lg ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
