import { ArrowRight, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { HomeModuleDefinition } from '../../config/homeModules';

interface ModuleCardProps {
  module: HomeModuleDefinition;
  variant?: 'primary' | 'compact';
  onSelect?: (module: HomeModuleDefinition) => void;
}

const accentStyles = {
  blue: {
    icon: 'border-blue-100 bg-blue-50 text-blue-600',
    edge: 'border-t-blue-500',
    hover: 'hover:border-blue-300 hover:bg-blue-50/30',
    action: 'text-blue-600',
  },
  amber: {
    icon: 'border-amber-100 bg-amber-50 text-amber-700',
    edge: 'border-t-amber-500',
    hover: 'hover:border-amber-300 hover:bg-amber-50/30',
    action: 'text-amber-700',
  },
  emerald: {
    icon: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    edge: 'border-t-emerald-500',
    hover: 'hover:border-emerald-300 hover:bg-emerald-50/30',
    action: 'text-emerald-700',
  },
  cyan: {
    icon: 'border-cyan-100 bg-cyan-50 text-cyan-700',
    edge: 'border-t-cyan-500',
    hover: 'hover:border-cyan-300 hover:bg-cyan-50/30',
    action: 'text-cyan-700',
  },
  rose: {
    icon: 'border-rose-100 bg-rose-50 text-rose-700',
    edge: 'border-t-rose-500',
    hover: 'hover:border-rose-300 hover:bg-rose-50/30',
    action: 'text-rose-700',
  },
  slate: {
    icon: 'border-slate-200 bg-slate-100 text-slate-600',
    edge: 'border-t-slate-500',
    hover: 'hover:border-slate-400 hover:bg-slate-50',
    action: 'text-slate-700',
  },
} as const;

function ModuleIcon({ module, compact }: { module: HomeModuleDefinition; compact: boolean }) {
  const Icon = module.icon;
  const isPlanned = module.status === 'planned';
  const accent = accentStyles[module.accent];

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-lg border ${compact ? 'size-9' : 'size-10'} ${
        isPlanned ? 'border-slate-200 bg-slate-100 text-slate-500' : accent.icon
      }`}
    >
      <Icon className={compact ? 'size-5' : 'size-5.5'} aria-hidden="true" />
    </div>
  );
}

function PlannedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
      <Clock3 className="size-3.5" aria-hidden="true" />
      规划中
    </span>
  );
}

function CardContent({ module, variant = 'primary' }: ModuleCardProps) {
  const isPlanned = module.status === 'planned';
  const accent = accentStyles[module.accent];

  if (variant === 'compact') {
    return (
      <>
        <div className="flex items-start justify-between gap-3">
          <ModuleIcon module={module} compact />
          <span className="font-mono text-[11px] font-medium text-slate-400">{module.code}</span>
        </div>
        <div className="mt-4 min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900">{module.title}</h3>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-500">{module.description}</p>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          {isPlanned ? <PlannedBadge /> : <span className={`text-xs font-medium ${accent.action}`}>进入功能</span>}
          {!isPlanned && (
            <ArrowRight className={`size-4 transition-transform group-hover:translate-x-0.5 ${accent.action}`} aria-hidden="true" />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <ModuleIcon module={module} compact={false} />
        <span className="font-mono text-xs font-medium text-slate-400">{module.code}</span>
      </div>
      <div className="mt-5 flex-1">
        <h3 className="line-clamp-2 text-base font-semibold leading-6 text-slate-950">{module.title}</h3>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-500">{module.description}</p>
      </div>
      <div className={`mt-5 flex items-center justify-between gap-3 text-sm font-medium ${isPlanned ? 'text-slate-400' : accent.action}`}>
        {isPlanned ? <PlannedBadge /> : <span>打开看板</span>}
        {!isPlanned && (
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        )}
      </div>
    </>
  );
}

export default function ModuleCard({ module, variant = 'primary', onSelect }: ModuleCardProps) {
  const isCompact = variant === 'compact';
  const accent = accentStyles[module.accent];
  const baseClassName = isCompact
    ? 'group flex min-h-[168px] w-full flex-col rounded-lg border border-t-2 p-4 text-left transition-colors'
    : 'group flex min-h-[196px] w-full flex-col rounded-lg border border-t-2 p-5 text-left transition-colors';
  const interactiveClassName = `border-slate-200 ${accent.edge} bg-white ${accent.hover} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2`;

  if (module.status === 'planned') {
    return (
      <article
        aria-disabled="true"
        className={`${baseClassName} border-slate-200 border-t-slate-300 bg-slate-50`}
      >
        <CardContent module={module} variant={variant} />
      </article>
    );
  }

  if (module.path) {
    return (
      <Link to={module.path} className={`${baseClassName} ${interactiveClassName}`}>
        <CardContent module={module} variant={variant} />
      </Link>
    );
  }

  if (module.action && onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(module)}
        className={`${baseClassName} ${interactiveClassName}`}
      >
        <CardContent module={module} variant={variant} />
      </button>
    );
  }

  return null;
}
