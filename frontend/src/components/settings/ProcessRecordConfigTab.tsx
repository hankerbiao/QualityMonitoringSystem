import { useState } from 'react';
import { Camera, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Server, XCircle } from 'lucide-react';
import { settingsApi } from '../../api/settingsApi';
import type { ProcessRecordConfig, ProcessRecordConnectionResult } from '../../types';

interface Props {
  config: ProcessRecordConfig;
  onChange: (config: ProcessRecordConfig) => void;
}

export function ProcessRecordConfigTab({ config, onChange }: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<ProcessRecordConnectionResult[]>([]);
  const [testError, setTestError] = useState('');

  const testConnection = async () => {
    setTesting(true);
    setTestError('');
    try {
      const result = await settingsApi.testProcessRecords(config);
      setResults(result.sources);
    } catch (error) {
      setResults([]);
      setTestError(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">关键工位影像数据源</h3>
        <p className="text-sm text-slate-500">两个实时系统共用一组账号密码，登录会话彼此独立。</p>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-xl">
        <div className="border border-slate-200 rounded-md px-3 py-2.5 bg-slate-50">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Camera className="w-4 h-4 text-cyan-600" /> 工序扫码拍照系统
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono">10.2.20.22</p>
        </div>
        <div className="border border-slate-200 rounded-md px-3 py-2.5 bg-slate-50">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Server className="w-4 h-4 text-emerald-600" /> 装配关键工位系统
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono">10.2.20.3:9991</p>
        </div>
      </div>

      <div className="space-y-4 max-w-xl">
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <KeyRound className="w-3.5 h-3.5 text-slate-400" /> 共享账号
          </label>
          <input
            value={config.username}
            onChange={(event) => onChange({ ...config, username: event.target.value })}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <KeyRound className="w-3.5 h-3.5 text-slate-400" /> 共享密码
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={config.password}
              onChange={(event) => onChange({ ...config, password: event.target.value })}
              placeholder={config.hasPassword ? '密码已配置，留空表示不修改' : '请输入共享密码'}
              className="w-full border border-slate-300 rounded-md px-3 py-2 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              autoComplete="new-password"
            />
            <button
              type="button"
              title={showPassword ? '隐藏密码' : '显示密码'}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            {config.hasPassword ? '数据库中已有密码。' : '尚未配置密码。'} 看板业务数据不会写入数据库。
          </p>
        </div>

        <button
          type="button"
          onClick={testConnection}
          disabled={testing || !config.username.trim() || (!config.password && !config.hasPassword)}
          className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
          {testing ? '正在测试两个系统...' : '测试连接'}
        </button>

        {testError && <p className="text-sm text-red-600">{testError}</p>}
        {results.length > 0 && (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
            {results.map((result) => (
              <div key={result.source} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <span className="text-slate-700">{result.name}</span>
                <span className={`inline-flex items-center gap-1.5 ${result.online ? 'text-emerald-700' : 'text-red-600'}`}>
                  {result.online ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {result.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
