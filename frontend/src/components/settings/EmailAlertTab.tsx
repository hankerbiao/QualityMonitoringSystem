import { Mail, Send, Loader2, CheckCircle2, XCircle, FileText, Hash } from 'lucide-react';
import { useState } from 'react';
import { settingsApi } from '../../api/settingsApi';

interface EmailAlertTabProps {
  config: {
    enabled: boolean;
    emails: string;
    triggerCondition: string;
    weeklyProductionThreshold: number;
    lrrAlertThreshold: number;
  };
  onChange: (config: {
    enabled: boolean;
    emails: string;
    triggerCondition: string;
    weeklyProductionThreshold: number;
    lrrAlertThreshold: number;
  }) => void;
}

export const DEFAULT_TRIGGER_CONDITION =
  '当某机型周生产量达到设定阈值（默认 50 台），且实际 RTY 低于目标直通率时，系统将在每天 17:00 自动发送预警邮件；同时，每日 17:30 系统将统计各物料故障率(LRR)，对有装配扫号且 LRR 达到设定阈值（默认 5%）的物料自动发送预警邮件。';

export function EmailAlertTab({ config, onChange }: EmailAlertTabProps) {
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleTest = async () => {
    if (!config.emails.trim()) {
      setTestMsg({ type: 'error', text: '请先填写接收人邮箱' });
      return;
    }
    setTesting(true);
    setTestMsg(null);
    try {
      const data = await settingsApi.testEmail(config.emails);
      if (data.sent) {
        setTestMsg({
          type: 'success',
          text: `测试邮件已发送至 ${data.recipients?.join(', ') || '配置邮箱'}`,
        });
      } else {
        const reason = data.reason === 'no_recipients' ? '收件人邮箱无效' : '发送失败，请检查邮件服务';
        setTestMsg({ type: 'error', text: reason });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '测试邮件发送失败';
      setTestMsg({ type: 'error', text: message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">邮件预警规则</h3>
        <p className="text-sm text-slate-500 mb-6">配置当直通率低于标准时的邮件预警行为与触发条件。</p>
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
        </div>

        {/* 触发条件说明（用户自定义文本） */}
        <div className={!config.enabled ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
          <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-slate-400" /> 触发条件说明
          </label>
          <textarea
            rows={3}
            value={config.triggerCondition}
            placeholder={DEFAULT_TRIGGER_CONDITION}
            onChange={(e) => onChange({ ...config, triggerCondition: e.target.value })}
            className="w-full border border-slate-300 rounded-md p-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y"
          />
          <button
            type="button"
            onClick={() => onChange({ ...config, triggerCondition: DEFAULT_TRIGGER_CONDITION })}
            className="mt-2 text-xs text-blue-600 hover:text-blue-800"
          >
            恢复默认说明
          </button>
        </div>

        {/* 周生产量阈值 */}
        <div className={!config.enabled ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
          <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
            <Hash className="w-4 h-4 text-slate-400" /> 周生产量阈值（台）
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              value={config.weeklyProductionThreshold}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ ...config, weeklyProductionThreshold: Number.isFinite(v) && v >= 0 ? v : 0 });
              }}
              className="w-32 border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-500">
              窗口内某机型投入台数 ≥ 该值，才纳入 RTY 判定
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            系统每天 17:00 自动统计：时间窗口为「上周五 00:00 至当前时刻」（滚动周窗口，最长 7 天）。
            对每个机型统计该窗口内的投入台数（按 SN 去重），达到上述阈值且实际 RTY 低于目标直通率时，自动发送预警邮件。
          </p>
        </div>

        {/* 物料故障率阈值 */}
        <div className={!config.enabled ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
          <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
            <Hash className="w-4 h-4 text-slate-400" /> 物料故障率阈值（%）
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              step={0.1}
              value={config.lrrAlertThreshold}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ ...config, lrrAlertThreshold: Number.isFinite(v) && v >= 0 ? v : 0 });
              }}
              className="w-32 border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-500">
              有装配扫号物料的故障率(LRR) ≥ 该值，即发送预警邮件
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            系统每天 17:30 自动统计：仅对「有装配扫号」物料计算故障率（无装配扫号物料无分母、不参与判定），
            达到上述阈值的物料将汇总在一封预警邮件中列出（含物料编号、总装配数、故障数、LRR、阈值）。
          </p>
        </div>

        {/* 预警接收人邮箱 */}
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

        <div className="pt-6 border-t border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-md text-sm font-medium transition-colors shadow-sm"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {testing ? '发送中...' : '发送测试邮件'}
            </button>
            {testMsg && (
              <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${testMsg.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                {testMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {testMsg.text}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            点击向当前配置的接收人邮箱发送一封测试邮件，验证邮件服务与收件人配置是否正确。
          </p>
        </div>
      </div>
    </div>
  );
}
