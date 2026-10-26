// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsApi } from '../../api/settingsApi';
import { EmailAlertTab } from './EmailAlertTab';

vi.mock('../../api/settingsApi', () => ({
  settingsApi: {
    testEmail: vi.fn(),
    sendCurrentEmailAlerts: vi.fn(),
    getWeeklyQualifiedModels: vi.fn(),
  },
}));

const modelTargets = { 'Model A': 90 };
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

  it('reports a partial send failure and keeps the rule page concise', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(settingsApi.sendCurrentEmailAlerts).mockResolvedValue({
      checked: true,
      threshold: 10,
      window: { from: '2026-10-23 00:00:00', to: '2026-10-26 10:00:00' },
      modelsChecked: 1,
      details: [{ productModel: 'Model A', inputCount: 10, defectCount: 2, rtyRate: 80, targetRate: 90 }],
      alertsSent: 0,
      alertsFailed: 1,
      failures: [{ productModel: 'Model A', reason: 'send_error', error: '邮件代理连接失败' }],
    });
    render(<EmailAlertTab config={config} modelTargets={modelTargets} canRunImmediately onChange={vi.fn()} />);

    expect(screen.queryByText('配置当直通率低于标准时的邮件预警行为与触发条件。')).toBeNull();
    expect(screen.getByRole('textbox', { name: '预警接收人邮箱' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '立即发送符合条件机型预警' }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(settingsApi.sendCurrentEmailAlerts).toHaveBeenCalledWith({
      enabled: true,
      emails: 'qa@example.com',
      weeklyProductionThreshold: 10,
      modelTargets,
    });
    expect((await screen.findByRole('alert')).textContent).toContain('1 个机型发送失败：Model A');
    expect(screen.queryByText('已尝试发送测试邮件')).toBeNull();
  });
});
