// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from './authApi';
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
});
