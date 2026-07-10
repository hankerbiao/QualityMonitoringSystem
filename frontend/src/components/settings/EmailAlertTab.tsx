import { Mail } from 'lucide-react';

interface EmailAlertTabProps {
  config: { enabled: boolean; emails: string; attachReport: boolean };
  onChange: (config: { enabled: boolean; emails: string; attachReport: boolean }) => void;
}

export function EmailAlertTab({ config, onChange }: EmailAlertTabProps) {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">邮件预警规则</h3>
        <p className="text-sm text-slate-500 mb-6">配置当直通率低于标准时的邮件预警行为。</p>
      </div>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={config.enabled}
                onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
            <span className="text-sm font-medium text-slate-700">启用异常指标邮件预警</span>
          </div>
          <p className="mt-2 text-xs text-slate-500 ml-14 leading-relaxed max-w-xl">
            当机型月度生产量或周生产量 &ge; 50台，且实际 RTY 低于设定的目标直通率时，系统将自动触发预警邮件。
          </p>
        </div>
        <div className={!config.enabled ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
          <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
            <Mail className="w-4 h-4 text-slate-400" /> 预警接收人邮箱
          </label>
          <textarea
            rows={3}
            value={config.emails}
            onChange={(e) => onChange({ ...config, emails: e.target.value })}
            className="w-full border border-slate-300 rounded-md p-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-xs text-slate-500 mt-1.5">支持配置多个邮箱，请使用分号 ( ; ) 分隔</p>
        </div>
        <div className={!config.enabled ? 'opacity-50 pointer-events-none' : ''}>
          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={config.attachReport}
              onChange={(e) => onChange({ ...config, attachReport: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-700">在告警邮件中附带故障明细数据及报表链接</span>
          </label>
        </div>
      </div>
    </div>
  );
}