import { Mail, Send, Loader2, CheckCircle2, XCircle, FileText, Hash, ListFilter } from 'lucide-react';
import { useState } from 'react';
import {
  settingsApi,
  type ManualWeeklyEmailCheckResult,
  type WeeklyQualifiedModels,
} from '../../api/settingsApi';
import type { ModelTargets } from '../../types';
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
  modelTargets: ModelTargets;
  canRunImmediately: boolean;
  onChange: (config: {
    enabled: boolean;
    emails: string;
    triggerCondition: string;
    weeklyProductionThreshold: number;
  }) => void;
}

export { buildTriggerCondition, DEFAULT_TRIGGER_CONDITION, DEFAULT_WEEKLY_PRODUCTION_THRESHOLD };

export function EmailAlertTab({ config, modelTargets, canRunImmediately, onChange }: EmailAlertTabProps) {
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
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

  const handleSendCurrentAlerts = async () => {
    if (!canRunImmediately) {
      setSendMsg({ type: 'error', text: '仅管理员可以立即发送预警邮件' });
      return;
    }
    if (!config.enabled) {
      setSendMsg({ type: 'error', text: '请先启用邮件预警规则' });
      return;
    }
    if (!config.emails.trim()) {
      setSendMsg({ type: 'error', text: '请先填写接收人邮箱' });
      return;
    }
    const confirmed = window.confirm(
      '将按当前统计窗口和页面配置筛选符合条件的机型，并向配置邮箱发送真实预警邮件。本次操作不会保存配置。是否继续？',
    );
    if (!confirmed) return;

    setSending(true);
    setSendMsg(null);
    try {
      const data: ManualWeeklyEmailCheckResult = await settingsApi.sendCurrentEmailAlerts({
        enabled: config.enabled,
        emails: config.emails,
        weeklyProductionThreshold: threshold,
        modelTargets,
      });
      setQualifiedModels(data);
      if (!data.checked && data.reason === 'disabled') {
        setSendMsg({ type: 'error', text: '邮件预警规则未启用，未发送邮件' });
      } else if ((data.alertsFailed ?? 0) > 0) {
        const failedModels = data.failures?.map(({ productModel }) => productModel).join('、');
        setSendMsg({
          type: 'error',
          text: `已发送 ${data.alertsSent ?? 0} 个机型，${data.alertsFailed} 个机型发送失败${failedModels ? `：${failedModels}` : ''}`,
        });
      } else if ((data.alertsSent ?? 0) === 0) {
        setSendMsg({ type: 'success', text: '当前条件下没有符合机型，未发送邮件' });
      } else {
        setSendMsg({ type: 'success', text: `已向 ${data.alertsSent} 个符合条件的机型发送预警邮件` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '预警邮件发送失败';
      setSendMsg({ type: 'error', text: message });
    } finally {
      setSending(false);
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
    <div className="space-y-5 max-w-2xl">
      <div className="space-y-5">
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
            rows={2}
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
          <p className="mt-1.5 text-xs text-slate-500">
            说明仅用于展示；预警按阈值和机型目标直通率判定。
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
            <span className="min-w-32 flex-1 text-xs text-slate-500">达到阈值后纳入 RTY 判定</span>
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
          <p className="text-xs text-slate-500 mt-2">系统每天 17:00 检查，满足条件时发送预警邮件。</p>
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
          <input
            aria-label="预警接收人邮箱"
            type="text"
            value={config.emails}
            onChange={(e) => onChange({ ...config, emails: e.target.value })}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-xs text-slate-500 mt-1.5">多个邮箱用分号分隔</p>
        </div>

        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSendCurrentAlerts}
              disabled={sending || !canRunImmediately || !config.enabled}
              title={!canRunImmediately ? '仅管理员可以立即发送预警邮件' : undefined}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-md text-sm font-medium transition-colors shadow-sm"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? '正在检查并发送...' : '立即发送符合条件机型预警'}
            </button>
            {sendMsg && (
              <span
                role={sendMsg.type === 'success' ? 'status' : 'alert'}
                className={`inline-flex min-w-0 items-start gap-1.5 break-words text-sm font-medium ${sendMsg.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}
              >
                {sendMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {sendMsg.text}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
