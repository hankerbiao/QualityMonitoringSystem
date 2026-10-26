// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsApi } from '../../api/settingsApi';
import { EmailAlertTab } from './EmailAlertTab';

vi.mock('../../api/settingsApi', () => ({
  settingsApi: {
    testEmail: vi.fn(),
    getWeeklyQualifiedModels: vi.fn(),
  },
}));

const config = {
  enabled: true,
  emails: 'qa@example.com',
  triggerCondition: '当某机型周生产量达到设定阈值（当前 10 台），且实际 RTY 低于目标直通率时，系统将在每天 17:00 自动发送预警邮件。',
  weeklyProductionThreshold: 10,
};

describe('EmailAlertTab', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('shows a useful mail-relay error and keeps the rule page concise', async () => {
    vi.mocked(settingsApi.testEmail).mockResolvedValue({
      sent: false,
      reason: 'send_error',
      error: '邮件代理请求异常: All connection attempts failed',
    });
    render(<EmailAlertTab config={config} onChange={vi.fn()} />);

    expect(screen.queryByText('配置当直通率低于标准时的邮件预警行为与触发条件。')).toBeNull();
    expect(screen.getByRole('textbox', { name: '预警接收人邮箱' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '发送测试邮件' }));

    expect((await screen.findByRole('alert')).textContent).toContain('邮件代理连接失败，请检查服务网络后重试');
    expect(screen.queryByText('已尝试发送测试邮件')).toBeNull();
  });
});
