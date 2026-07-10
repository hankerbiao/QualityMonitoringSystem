import { Key } from 'lucide-react';
import type { AIConfig } from '../../types';

interface AIConfigTabProps {
  config: AIConfig;
  onChange: (config: AIConfig) => void;
}

export function AIConfigTab({ config, onChange }: AIConfigTabProps) {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">AI 模型配置</h3>
        <p className="text-sm text-slate-500 mb-6">配置 AI 助手使用的模型服务。</p>
      </div>
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">API 地址</label>
          <input
            type="text"
            value={config.apiUrl}
            onChange={(e) => onChange({ ...config, apiUrl: e.target.value })}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <p className="text-xs text-slate-500 mt-1">支持 OpenAI 兼容格式的 API 地址</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">模型 ID</label>
          <input
            type="text"
            value={config.modelId}
            onChange={(e) => onChange({ ...config, modelId: e.target.value })}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-slate-400" /> API Key
          </label>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
            placeholder="留空则不修改"
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">最大 Token 数</label>
          <input
            type="number"
            value={config.maxTokens}
            onChange={(e) => onChange({ ...config, maxTokens: parseInt(e.target.value) || 4096 })}
            className="w-48 border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <p className="text-xs text-slate-500 mt-1">控制单次响应的最大 token 数量，防止回复过长</p>
        </div>
      </div>
    </div>
  );
}