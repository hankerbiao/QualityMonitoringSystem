import { describe, expect, it } from 'vitest';
import {
  buildTriggerCondition,
  DEFAULT_TRIGGER_CONDITION,
  DEFAULT_WEEKLY_PRODUCTION_THRESHOLD,
  isGeneratedTriggerCondition,
} from './emailAlert';

describe('email alert rule descriptions', () => {
  it('uses the requested default rule', () => {
    expect(DEFAULT_WEEKLY_PRODUCTION_THRESHOLD).toBe(10);
    expect(DEFAULT_TRIGGER_CONDITION).toBe(
      '当某机型周生产量达到设定阈值（默认 10 台），且实际 RTY 低于目标直通率时，系统将在每天 17:00 自动发送预警邮件。',
    );
  });

  it('describes a user configured threshold', () => {
    expect(buildTriggerCondition(25)).toBe(
      '当某机型周生产量达到设定阈值（当前 25 台），且实际 RTY 低于目标直通率时，系统将在每天 17:00 自动发送预警邮件。',
    );
    expect(isGeneratedTriggerCondition(buildTriggerCondition(25))).toBe(true);
  });

  it('normalizes invalid thresholds before describing them', () => {
    expect(buildTriggerCondition(-2)).toContain('当前 0 台');
    expect(buildTriggerCondition(Number.NaN)).toBe(DEFAULT_TRIGGER_CONDITION);
    expect(isGeneratedTriggerCondition('用户自定义说明')).toBe(false);
  });
});
