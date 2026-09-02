import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, LayoutDashboard } from 'lucide-react';

const dashboards = [
  { path: '/rty', label: 'RTY', description: '整机综合直通率' },
  { path: '/station-pass-rate', label: 'STATION RTY', description: '工位过站直通率' },
  { path: '/lrr', label: 'LRR', description: '工厂阶段部件故障率' },
  { path: '/doa', label: 'DOA', description: '报修率' },
  { path: '/mfr', label: 'MFR', description: '现网月化故障率' },
] as const;

export function DashboardSwitcher() {
  const { pathname } = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentDashboard = dashboards.find((dashboard) => dashboard.path === pathname) ?? dashboards[0];

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <LayoutDashboard className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{currentDashboard.label}</span>
        <ChevronDown className={`size-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <div role="menu" aria-label="切换质量看板" className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10">
          {dashboards.map((dashboard) => {
            const isCurrent = dashboard.path === pathname;
            return (
              <Link
                key={dashboard.path}
                to={dashboard.path}
                role="menuitem"
                aria-current={isCurrent ? 'page' : undefined}
                onClick={() => setIsOpen(false)}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 transition-colors ${isCurrent ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <span className="text-sm font-semibold">{dashboard.label}</span>
                <span className="text-xs text-slate-500">{dashboard.description}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
