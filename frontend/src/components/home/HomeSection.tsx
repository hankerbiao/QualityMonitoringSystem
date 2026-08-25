import type { HomeModuleDefinition } from '../../config/homeModules';
import ModuleCard from './ModuleCard';

interface HomeSectionProps {
  id: string;
  title: string;
  description: string;
  modules: readonly HomeModuleDefinition[];
  variant?: 'primary' | 'compact';
  onModuleSelect?: (module: HomeModuleDefinition) => void;
}

export default function HomeSection({
  id,
  title,
  description,
  modules,
  variant = 'compact',
  onModuleSelect,
}: HomeSectionProps) {
  const availableCount = modules.filter((module) => module.status === 'available').length;

  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-slate-950">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-slate-500">
          <span className="font-mono text-slate-400">{String(modules.length).padStart(2, '0')}</span>
          <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
          <span>{availableCount} 个可用</span>
        </div>
      </div>

      <div
        className={
          variant === 'primary'
            ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'
            : 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'
        }
      >
        {modules.map((module) => (
          <ModuleCard
            key={module.id}
            module={module}
            variant={variant}
            onSelect={onModuleSelect}
          />
        ))}
      </div>
    </section>
  );
}
