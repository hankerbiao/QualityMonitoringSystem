import { Activity, AlertTriangle, BarChart3, Factory, Wrench } from 'lucide-react';
import {
  DEFAULT_DASHBOARD_STATUSES,
  fieldQualityModules,
  qualityModules,
  repairProcessModules,
  toolModules,
  type HomeModuleStatus,
} from '../../config/homeModules';

interface Props {
  statuses: Record<string, HomeModuleStatus>;
  onChange: (statuses: Record<string, HomeModuleStatus>) => void;
}

const icons = {
  rty: Activity,
  'station-pass-rate': Factory,
  'repair-quality': Wrench,
  'reinsert-rate': Wrench,
  lrr: AlertTriangle,
  doa: Wrench,
  mfr: BarChart3,
  'incoming-materials': AlertTriangle,
} as const;

export default function DashboardStatusTab({ statuses, onChange }: Props) {
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-800">看板状态管理</h3>
        <p className="mt-1 text-sm text-slate-500">
          控制首页和看板切换器中的显示状态。“仅管理员可见”不会展示给普通用户。
        </p>
      </div>
      <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {[...qualityModules, ...repairProcessModules, ...fieldQualityModules, ...toolModules.filter(module => module.id === 'incoming-materials')].map((module) => {
          const Icon = icons[module.id as keyof typeof icons];
          const status = statuses[module.id] ?? DEFAULT_DASHBOARD_STATUSES[module.id];
          return (
            <label
              key={module.id}
              className="flex items-center justify-between gap-4 px-4 py-3.5"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {module.title}
                  </span>
                  <span className="block truncate text-xs text-slate-400">{module.code}</span>
                </span>
              </span>
              <select
                aria-label={`${module.title}看板状态`}
                value={status}
                onChange={(event) =>
                  onChange({
                    ...DEFAULT_DASHBOARD_STATUSES,
                    ...statuses,
                    [module.id]: event.target.value as HomeModuleStatus,
                  })
                }
                className="h-9 shrink-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="available">可用</option>
                <option value="admin-only">仅管理员可见</option>
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}
