import { Mail, Send, Loader2, CheckCircle2, XCircle, FileText, Hash, ListFilter } from 'lucide-react';
import { useState } from 'react';
import { settingsApi, type WeeklyQualifiedModels } from '../../api/settingsApi';
import {
  buildTriggerCondition,
  DEFAULT_TRIGGER_CONDITION,
  DEFAULT_WEEKLY_PRODUCTION_THRESHOLD,
  isGeneratedTriggerCondition,
} from '../../utils/emailAlert';

interface EmailAlertTabProps {
  config: {
    enabled: boolean;
    emails: string;
    triggerCondition: string;
    weeklyProductionThreshold: number;
  };
  onChange: (config: {
    enabled: boolean;
    emails: string;
    triggerCondition: string;
    weeklyProductionThreshold: number;
  }) => void;
}

export { buildTriggerCondition, DEFAULT_TRIGGER_CONDITION, DEFAULT_WEEKLY_PRODUCTION_THRESHOLD };

export function EmailAlertTab({ config, onChange }: EmailAlertTabProps) {
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [qualifiedModels, setQualifiedModels] = useState<WeeklyQualifiedModels | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const threshold = Number.isFinite(config.weeklyProductionThreshold)
    ? Math.max(0, Math.trunc(config.weeklyProductionThreshold))
    : DEFAULT_WEEKLY_PRODUCTION_THRESHOLD;
  const generatedTriggerCondition = buildTriggerCondition(threshold);
  const triggerCondition = config.triggerCondition.trim() && !isGeneratedTriggerCondition(config.triggerCondition)
    ? config.triggerCondition
    : generatedTriggerCondition;

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

  const handleGetQualifiedModels = async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      setQualifiedModels(await settingsApi.getWeeklyQualifiedModels(config.weeklyProductionThreshold));
    } catch (err) {
      setQualifiedModels(null);
      setModelsError(err instanceof Error ? err.message : '符合条件的机型获取失败');
    } finally {
      setLoadingModels(false);
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

        {/* 触发条件说明：系统按规则参数生成，也允许用户补充展示文字。 */}
        <div className={!config.enabled ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
          <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-slate-400" /> 触发条件说明
          </label>
          <textarea
            rows={3}
            value={triggerCondition}
            onChange={(e) => onChange({ ...config, triggerCondition: e.target.value })}
            className="w-full border border-slate-300 rounded-md p-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y"
          />
          <button
            type="button"
            onClick={() => onChange({ ...config, triggerCondition: generatedTriggerCondition })}
            className="mt-2 text-xs text-blue-600 hover:text-blue-800"
          >
            按当前规则生成说明
          </button>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            修改周生产量阈值后，系统生成的说明会同步更新；手工修改此文本只影响说明展示，不改变实际预警判定规则。
          </p>
        </div>

        {/* 周生产量阈值 */}
        <div className={!config.enabled ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
          <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
            <Hash className="w-4 h-4 text-slate-400" /> 周生产量阈值（台）
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="number"
              min={0}
              value={config.weeklyProductionThreshold}
              onChange={(e) => {
                const v = Number(e.target.value);
                const nextThreshold = Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0;
                const nextTriggerCondition = !config.triggerCondition.trim()
                  || isGeneratedTriggerCondition(config.triggerCondition)
                  ? buildTriggerCondition(nextThreshold)
                  : config.triggerCondition;
                onChange({
                  ...config,
                  weeklyProductionThreshold: nextThreshold,
                  triggerCondition: nextTriggerCondition,
                });
              }}
              className="w-32 shrink-0 border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <span className="min-w-32 flex-1 text-xs text-slate-500">
              窗口内某机型投入台数 ≥ 该值，才纳入 RTY 判定
            </span>
            <button
              type="button"
              onClick={handleGetQualifiedModels}
              disabled={loadingModels}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 rounded-md text-sm font-medium transition-colors"
            >
              {loadingModels ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListFilter className="w-4 h-4" />}
              {loadingModels ? '查询中...' : '查看符合机型'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            系统每天 17:00 自动统计：时间窗口为「上周五 00:00 至当前时刻」（滚动周窗口，最长 7 天）。
            对每个机型统计该窗口内的投入台数（按 SN 去重），达到上述阈值且实际 RTY 低于目标直通率时，自动发送预警邮件。
          </p>
          {modelsError && <p className="mt-3 text-sm text-red-600">{modelsError}</p>}
          {qualifiedModels && (
            <div className="mt-3 border border-slate-200 rounded-md overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 text-xs text-slate-500">
                统计窗口：{qualifiedModels.window.from} 至 {qualifiedModels.window.to}，达到产量阈值机型 {qualifiedModels.modelsChecked} 个
              </div>
              {qualifiedModels.details.length === 0 ? (
                <p className="px-3 py-4 text-sm text-slate-500">暂无 RTY 未达标的符合机型</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-white text-xs text-slate-500 border-y border-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-medium">机型</th>
                        <th className="px-3 py-2 font-medium">投入</th>
                        <th className="px-3 py-2 font-medium">故障</th>
                        <th className="px-3 py-2 font-medium">RTY</th>
                        <th className="px-3 py-2 font-medium">目标</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {qualifiedModels.details.map((model) => (
                        <tr key={model.productModel}>
                          <td className="px-3 py-2 font-medium">{model.productModel}</td>
                          <td className="px-3 py-2">{model.inputCount}</td>
                          <td className="px-3 py-2">{model.defectCount}</td>
                          <td className="px-3 py-2 text-red-600">{model.rtyRate}%</td>
                          <td className="px-3 py-2">{model.targetRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
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
