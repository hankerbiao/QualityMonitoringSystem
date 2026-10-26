// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import type { SettingsResponse } from '../types';
import SettingsModal from './SettingsModal';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/SettingsContext', () => ({ useSettings: vi.fn() }));

const settings: SettingsResponse = {
  processRecords: { username: 'private-source', password: '', hasPassword: true },
  modelTargets: { X1: 98 },
  emailAlert: {
    enabled: true, emails: 'quality@company.com', triggerCondition: 'existing-rule',
    weeklyProductionThreshold: 50,
  },
  dashboardStatuses: { doa: 'planned' },
  cycleStatsConfig: { selectedModels: [] },
  stationPassRateConfig: { selectedStations: [], configured: false },
};
const updateSettings = vi.fn();

function setRole(role: 'user' | 'admin') {
  vi.mocked(useAuth).mockReturnValue({
    user: { itcode: 'alice', role }, isAuthenticated: true, isAuthLoaded: true,
    login: vi.fn(), logout: vi.fn(),
  });
}

describe('settings pages by role', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setRole('user');
    updateSettings.mockResolvedValue(undefined);
    vi.mocked(useSettings).mockReturnValue({
      settings, loading: false, updateSettings, error: null, reloadSettings: vi.fn(),
    });
  });
  afterEach(() => cleanup());

  it('shows business settings and own password to ordinary users and saves only business settings', async () => {
    const onSaved = vi.fn();
    render(<SettingsModal onClose={vi.fn()} onSaved={onSaved} />);
    const navigation = screen.getByRole('navigation');
    expect(within(navigation).getAllByRole('button').map(button => button.textContent))
      .toEqual(['机型指标配置', '邮件预警规则', '修改密码']);
    expect(within(navigation).queryByRole('button', { name: '看板状态' })).toBeNull();
    expect(screen.queryByText('看板状态管理')).toBeNull();
    expect(screen.getByText('直通率标准配置')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('98'), { target: { value: '99' } });
    fireEvent.click(within(navigation).getByRole('button', { name: '邮件预警规则' }));
    fireEvent.change(screen.getByDisplayValue('quality@company.com'), {
      target: { value: 'updated@company.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(updateSettings).toHaveBeenCalledWith({
      modelTargets: { X1: 99 },
      emailAlert: { ...settings.emailAlert, emails: 'updated@company.com' },
    });
  });

  it('retains every configuration page and full save access for administrators', async () => {
    setRole('admin');
    render(<SettingsModal onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(within(screen.getByRole('navigation')).getAllByRole('button').map(button => button.textContent))
      .toEqual(['影像数据源', '机型指标配置', '邮件预警规则', '看板状态', '用户管理', '修改密码']);
    fireEvent.click(screen.getByRole('button', { name: '看板状态' }));
    expect(screen.getByText('看板状态管理')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('DOA 报修率看板状态'), { target: { value: 'admin-only' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      processRecords: { username: 'private-source', password: '' },
      modelTargets: settings.modelTargets,
      emailAlert: settings.emailAlert,
      dashboardStatuses: {
        ...settings.dashboardStatuses,
        rty: 'available',
        'station-pass-rate': 'available',
        lrr: 'available',
        doa: 'admin-only',
        mfr: 'planned',
      },
    }));
  });

  it('saves imported targets through the existing settings action, preserving unlisted models', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['机型名称', '直通率标准 (%)'], ['M1', 99.5], ['M2', null],
    ]), '直通率标准');
    const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'targets.xlsx');
    render(<SettingsModal onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('选择直通率标准模板'), { target: { files: [file] } });
    expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已导入'));
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      modelTargets: { X1: 98, M1: 99.5, M2: 100 },
      emailAlert: settings.emailAlert,
    }));
  });

  it('switches away from restricted content immediately after demotion', () => {
    setRole('admin');
    const { rerender } = render(<SettingsModal onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByDisplayValue('private-source')).toBeTruthy();
    setRole('user');
    rerender(<SettingsModal onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByDisplayValue('private-source')).toBeNull();
    expect(screen.queryByRole('button', { name: '影像数据源' })).toBeNull();
    expect(screen.getByText('直通率标准配置')).toBeTruthy();
  });

  it('reports save errors without closing or reporting success', async () => {
    updateSettings.mockRejectedValue(new Error('配置保存失败'));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect((await screen.findByRole('alert')).textContent).toContain('配置保存失败');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables saving and hides editable drafts when loading fails, with a retry action', () => {
    const reloadSettings = vi.fn();
    vi.mocked(useSettings).mockReturnValue({
      settings, loading: false, updateSettings, error: '配置读取失败', reloadSettings,
    });
    render(<SettingsModal onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('配置读取失败');
    expect(screen.queryByDisplayValue('98')).toBeNull();
    const save = screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(reloadSettings).toHaveBeenCalledOnce();
  });

  it('keeps the dialog closeable while loading and prevents saving', () => {
    vi.mocked(useSettings).mockReturnValue({
      settings, loading: true, updateSettings, error: null, reloadSettings: vi.fn(),
    });
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} onSaved={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('加载配置中');
    expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByDisplayValue('98')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭系统配置' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(['user', 'admin'] as const)('opens own password change for %s without the configuration save action', (role) => {
    setRole(role);
    render(<SettingsModal onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByLabelText('当前密码', { exact: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存配置' })).toBeNull();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('allows password changes even if business settings fail to load', () => {
    vi.mocked(useSettings).mockReturnValue({
      settings, loading: false, updateSettings, error: '配置读取失败', reloadSettings: vi.fn(),
    });
    render(<SettingsModal onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByLabelText('当前密码', { exact: true })).toBeTruthy();
    expect(screen.queryByText('配置读取失败')).toBeNull();
  });
});
