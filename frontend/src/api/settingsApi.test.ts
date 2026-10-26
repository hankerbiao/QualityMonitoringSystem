// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestData, requestJson } from './authApi';
import { settingsApi } from './settingsApi';

vi.mock('./authApi', () => ({
  requestData: vi.fn(),
  requestJson: vi.fn(),
}));

describe('settingsApi.testEmail', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns failed test-email details from an unsuccessful API envelope', async () => {
    vi.mocked(requestJson).mockResolvedValue({
      success: false,
      message: '已尝试发送测试邮件',
      data: {
        sent: false,
        reason: 'send_error',
        error: '邮件代理请求异常: All connection attempts failed',
      },
    });

    await expect(settingsApi.testEmail('qa@example.com')).resolves.toEqual({
      sent: false,
      reason: 'send_error',
      error: '邮件代理请求异常: All connection attempts failed',
    });
  });

  it('submits the current email-alert rule for immediate sending', async () => {
    const config = {
      enabled: true,
      emails: 'qa@example.com',
      weeklyProductionThreshold: 12,
      modelTargets: { 'Model A': 98 },
    };
    const result = {
      checked: true,
      threshold: 12,
      window: { from: '2026-10-23 00:00:00', to: '2026-10-26 10:00:00' },
      modelsChecked: 1,
      details: [],
      alertsSent: 0,
      alertsFailed: 0,
      failures: [],
    };
    vi.mocked(requestData).mockResolvedValue(result);

    await expect(settingsApi.sendCurrentEmailAlerts(config)).resolves.toEqual(result);
    expect(requestData).toHaveBeenCalledWith(
      expect.stringContaining('/settings/email-alert/send-current'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      },
    );
  });
});
