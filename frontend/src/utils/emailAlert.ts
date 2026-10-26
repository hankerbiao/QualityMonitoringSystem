export const DEFAULT_WEEKLY_PRODUCTION_THRESHOLD = 10;

export function buildTriggerCondition(threshold: number): string {
  const normalizedThreshold = Number.isFinite(threshold)
    ? Math.max(0, Math.trunc(threshold))
    : DEFAULT_WEEKLY_PRODUCTION_THRESHOLD;
  const label = normalizedThreshold === DEFAULT_WEEKLY_PRODUCTION_THRESHOLD ? '默认' : '当前';
  return `当某机型周生产量达到设定阈值（${label} ${normalizedThreshold} 台），且实际 RTY 低于目标直通率时，系统将在每天 17:00 自动发送预警邮件。`;
}

export const DEFAULT_TRIGGER_CONDITION = buildTriggerCondition(
  DEFAULT_WEEKLY_PRODUCTION_THRESHOLD,
);

export function isGeneratedTriggerCondition(value: string): boolean {
  return /^当某机型周生产量达到设定阈值（(?:默认|当前) \d+ 台），且实际 RTY 低于目标直通率时，系统将在每天 17:00 自动发送预警邮件。$/.test(
    value.trim(),
  );
}
