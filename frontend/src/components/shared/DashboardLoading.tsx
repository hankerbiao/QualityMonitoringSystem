import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DashboardLoadingProps {
  dashboard: 'DOA' | 'MFR';
}

export function DashboardLoading({ dashboard }: DashboardLoadingProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (dashboard !== 'MFR') return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [dashboard]);

  return (
    <div role="status" aria-live="polite" aria-label={`正在加载 ${dashboard} 看板数据`} className="space-y-3">
      <div className="overflow-hidden border border-teal-100 bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <Activity className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">正在加载 {dashboard} 看板数据</p>
            <p className="mt-0.5 text-xs text-slate-500">{dashboard === 'MFR'
              ? elapsedSeconds >= 8 ? '数据量较大，仍在加载，请稍候' : '正在读取订单、服务单和换件数据'
              : '正在汇总所选范围内的数据'}</p>
          </div>
          {dashboard === 'MFR' && elapsedSeconds > 0 && <span aria-hidden="true" className="shrink-0 font-mono text-xs tabular-nums text-slate-500">已等待 {elapsedSeconds} 秒</span>}
          <span aria-hidden="true" className="dashboard-loading-dots flex shrink-0 gap-1">
            <i /><i /><i />
          </span>
        </div>
        {dashboard === 'MFR' && <div aria-hidden="true" className="h-0.5 overflow-hidden bg-teal-50"><div className="dashboard-loading-indicator h-full w-1/3 bg-teal-600" /></div>}
      </div>

      <div aria-hidden="true" className="space-y-3">
        <div className="grid grid-cols-2 overflow-hidden border border-slate-200 bg-white lg:grid-cols-4">
          {[0, 1, 2, 3].map(index => <div key={index} className="space-y-3 border-b border-r border-slate-100 px-4 py-4 lg:border-b-0">
            <div className="dashboard-skeleton h-2.5 w-20 max-w-full" />
            <div className="dashboard-skeleton h-6 w-24 max-w-full" />
            <div className="dashboard-skeleton h-2 w-28 max-w-full" />
          </div>)}
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
          <div className="min-w-0 border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-4"><div className="dashboard-skeleton h-3 w-24" /></div>
            <div className="flex h-56 items-end gap-3 px-5 pb-5 pt-7 sm:gap-5">
              {[34, 56, 42, 71, 58, 82, 63, 91, 68, 78].map((height, index) => <div key={index} className="dashboard-loading-column flex-1 rounded-t-sm bg-teal-100" style={{ height: `${height}%`, animationDelay: `${index * 80}ms` }} />)}
            </div>
          </div>
          <div className="border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-4"><div className="dashboard-skeleton h-3 w-20" /></div>
            <div className="space-y-5 px-4 py-5">
              {[85, 67, 76, 53].map(width => <div key={width} className="flex items-center gap-3">
                <div className="dashboard-skeleton size-6 shrink-0" />
                <div className="flex-1 space-y-2"><div className="dashboard-skeleton h-2.5 w-24" /><div className="dashboard-skeleton h-1.5" style={{ width: `${width}%` }} /></div>
                <div className="dashboard-skeleton h-3 w-10" />
              </div>)}
            </div>
          </div>
        </div>
        <div className="border border-slate-200 bg-white px-4 py-4">
          <div className="dashboard-skeleton h-3 w-20" />
          <div className="mt-5 space-y-3">{[0, 1, 2].map(row => <div key={row} className="dashboard-skeleton h-3 w-full" />)}</div>
        </div>
      </div>
    </div>
  );
}
