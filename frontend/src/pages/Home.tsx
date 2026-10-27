import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Boxes,
  ChevronDown,
  LayoutGrid,
  LogOut,
  Mail,
  Search,
  Settings as SettingsIcon,
  Settings2,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import HomeSection from '../components/home/HomeSection';
import SettingsModal from '../components/SettingsModal';
import {
  fieldQualityModules,
  managementModules,
  qualityModules,
  toolModules,
} from '../config/homeModules';
import type { HomeModuleDefinition } from '../config/homeModules';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import appPackage from '../../package.json';

type ModuleFilter = 'all' | 'quality' | 'field-quality' | 'tools' | 'management';

const moduleFilters = [
  { id: 'all', label: '全部', icon: LayoutGrid },
  { id: 'quality', label: '质量看板', icon: BarChart3 },
  { id: 'field-quality', label: '交付与现网质量', icon: Boxes },
  { id: 'tools', label: '关键工位影像追溯', icon: Wrench },
  { id: 'management', label: '运营监控', icon: Settings2, adminOnly: true },
] as const;

export default function Home() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ModuleFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const { settings } = useSettings();

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayName = user?.姓名 || user?.真实姓名 || user?.name || user?.itcode || '';
  const avatarChar = displayName.charAt(0) || 'U';
  const department = user?.部门 || user?.department || '';
  const email = user?.邮件 || user?.email || '';
  const isAdmin = user?.role === 'admin';
  useEffect(() => {
    if (!isAdmin) {
      setActiveFilter(current => current === 'management' ? 'all' : current);
    }
  }, [isAdmin]);
  const dashboardPermissions = new Set(user?.dashboardPermissions ?? []);
  const canView = (id: string) => isAdmin || dashboardPermissions.has(id);
  const visibleDashboards = (modules: readonly HomeModuleDefinition[]) =>
    modules
      .map((module) => ({
        ...module,
        status: settings.dashboardStatuses[module.id] ?? module.status,
      }))
      .filter((module) => canView(module.id) && (isAdmin || module.status !== 'admin-only'));
  const visibleQualityModules = visibleDashboards(qualityModules);
  const visibleFieldQualityModules = visibleDashboards(fieldQualityModules);
  const visibleToolModules = toolModules.filter((module) => canView(module.id));
  const visibleModules = [
    ...visibleQualityModules,
    ...visibleFieldQualityModules,
    ...visibleToolModules,
    ...(isAdmin ? managementModules : []),
  ];
  const availableFunctionCount = visibleModules.filter(
    (module) => module.status === 'available' || (isAdmin && module.status === 'admin-only'),
  ).length;
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filterModules = (modules: readonly HomeModuleDefinition[]) =>
    modules.filter((module) =>
      [module.code, module.title, module.description]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  const filteredQualityModules = filterModules(visibleQualityModules);
  const filteredFieldQualityModules = filterModules(visibleFieldQualityModules);
  const filteredToolModules = filterModules(visibleToolModules);
  const filteredManagementModules = filterModules(managementModules);
  const showQuality = activeFilter === 'all' || activeFilter === 'quality';
  const showFieldQuality = activeFilter === 'all' || activeFilter === 'field-quality';
  const showTools = activeFilter === 'all' || activeFilter === 'tools';
  const showManagement = isAdmin && (activeFilter === 'all' || activeFilter === 'management');
  const hasToolResults = showTools && filteredToolModules.length > 0;
  const resultCount =
    (showQuality ? filteredQualityModules.length : 0) +
    (showFieldQuality ? filteredFieldQualityModules.length : 0) +
    (showTools ? filteredToolModules.length : 0) +
    (showManagement ? filteredManagementModules.length : 0);

  const openSettings = () => {
    setIsSettingsOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 selection:bg-blue-500/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold leading-5 text-slate-950">QualiBoard</p>
              <p className="text-xs leading-4 text-slate-400">品质看板</p>
            </div>
          </div>

            {user && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                onClick={() => setUserMenuOpen((open) => !open)}
                className="flex min-h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left transition-colors hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-xs font-semibold text-white">
                  {avatarChar}
                </div>
                <div className="hidden min-w-0 sm:block">
                  <p className="max-w-28 truncate text-sm font-medium leading-5 text-slate-800">{displayName}</p>
                </div>
                <ChevronDown
                  className={`size-4 text-slate-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-2 shadow-lg shadow-slate-900/10"
                >
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-800">{displayName}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {[user.itcode, department].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {email && (
                    <div className="flex items-start gap-2 px-4 py-2 text-xs text-slate-500">
                      <Mail className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="break-all">{email}</span>
                    </div>
                  )}
                  <div className="mt-1 border-t border-slate-100 pt-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <LogOut className="size-4" aria-hidden="true" />
                      退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        <div className="flex flex-col gap-4 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">质量监控工作台</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              汇聚生产、交付和现网质量数据，快速进入日常监控、追溯与系统管理工作。
            </p>
          </div>
          <div className="flex items-center gap-5 text-xs text-slate-500">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
              {availableFunctionCount} 个功能可用
            </span>
            <button
              type="button"
              onClick={openSettings}
              aria-label="系统配置管理"
              className="-mr-1 ml-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 bg-white text-sm text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <SettingsIcon className="size-3.5" aria-hidden="true" />
              <span>系统配置</span>
            </button>
          </div>
        </div>

        <div className="sticky top-0 z-30 -mx-4 border-y border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label="功能分类">
              {moduleFilters.map((filter) => {
                if ('adminOnly' in filter && filter.adminOnly && !isAdmin) return null;
                const FilterIcon = filter.icon;
                const selected = activeFilter === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveFilter(filter.id)}
                    className={`flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      selected ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white hover:text-slate-950'
                    }`}
                  >
                    <FilterIcon className="size-4" aria-hidden="true" />
                    {filter.label}
                  </button>
                );
              })}
            </div>

            <div className="relative w-full lg:w-72">
              <label htmlFor="module-search" className="sr-only">搜索功能</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="module-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索看板或工具"
                className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="清空搜索"
                  className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-9 py-7">
          {showQuality && filteredQualityModules.length > 0 && (
            <HomeSection
              id="quality-dashboards"
              title="核心质量看板"
              description="覆盖生产阶段的关键质量表现。"
              modules={filteredQualityModules}
              variant="primary"
            />
          )}

          {showFieldQuality && filteredFieldQualityModules.length > 0 && (
            <HomeSection
              id="field-quality-dashboards"
              title="交付与现网质量"
              description="关注开箱报修及现网故障表现。"
              modules={filteredFieldQualityModules}
              variant="primary"
            />
          )}

          {hasToolResults && (
            <div className="grid gap-9">
              <HomeSection
                id="quality-tools"
                title="关键工位影像追溯"
                description="用于调查问题、追溯过程与定位原因。"
                modules={filteredToolModules}
              />
            </div>
          )}

          {showManagement && filteredManagementModules.length > 0 && (
            <HomeSection
              id="management-tools"
              title="运营监控"
              description="平台运营和配置维护，仅管理员可见。"
              modules={filteredManagementModules}
            />
          )}

          {resultCount === 0 && (
            <div className="flex min-h-52 flex-col items-center justify-center border-y border-dashed border-slate-300 text-center">
              <Search className="size-6 text-slate-300" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-slate-700">没有匹配的功能</p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveFilter('all');
                }}
                className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                重置筛选
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="mx-auto flex max-w-7xl flex-col gap-2 border-t border-slate-200 px-4 py-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <span>5000公司信息系统开发部</span>
        <span>版本 v{appPackage.version}</span>
        <span>有问题请联系 @libiao1</span>
      </footer>

      {isSettingsOpen && (
        <SettingsModal
          onClose={() => setIsSettingsOpen(false)}
          onSaved={() => window.dispatchEvent(new CustomEvent('settings-saved'))}
        />
      )}
    </div>
  );
}
