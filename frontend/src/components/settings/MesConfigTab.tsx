import { Eye, EyeOff, Key } from 'lucide-react';

interface MesConfigTabProps {
  config: { username: string; password: string };
  onChange: (config: { username: string; password: string }) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
}

export function MesConfigTab({ config, onChange, showPassword, onTogglePassword }: MesConfigTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">MES 系统接入配置</h3>
        <p className="text-sm text-slate-500 mb-6">配置连接 MES 数据库所需的 API 凭证。</p>
      </div>
      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-slate-400" /> 账号
          </label>
          <input
            type="text"
            value={config.username}
            onChange={(e) => onChange({ ...config, username: e.target.value })}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-slate-400" /> 密码
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={config.password}
              onChange={(e) => onChange({ ...config, password: e.target.value })}
              className="w-full border border-slate-300 rounded-md px-3 py-2 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
            <button
              type="button"
              onClick={onTogglePassword}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 bg-blue-50/50 text-blue-700/80 px-3 py-2.5 rounded border border-blue-100">
          注: 该账号用于系统后台定期从 MES (10.8.101.49:9991) 自动拉取 RTY 和 LRR 数据。
        </p>
      </div>
    </div>
  );
}