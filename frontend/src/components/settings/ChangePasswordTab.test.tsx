// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changePassword } from '../../api/authApi';
import { useAuth } from '../../context/AuthContext';
import ChangePasswordTab from './ChangePasswordTab';

vi.mock('../../api/authApi', () => ({ changePassword: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
const logout = vi.fn();

function fillPasswords(current = 'old-password', next = 'NewPassword123', confirmation = next) {
  fireEvent.change(screen.getByLabelText('当前密码', { exact: true }), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('新密码', { exact: true }), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('确认新密码', { exact: true }), { target: { value: confirmation } });
}

describe('self-service password change', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { itcode: 'alice', role: 'user' },
      isAuthenticated: true, isAuthLoaded: true, login: vi.fn(), logout,
    });
    vi.mocked(changePassword).mockResolvedValue(undefined);
  });
  afterEach(() => cleanup());

  it('changes the password, clears the form, and offers a fresh login', async () => {
    render(<ChangePasswordTab />);
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
    await screen.findByRole('status');
    expect(changePassword).toHaveBeenCalledWith('old-password', 'NewPassword123');
    expect(screen.queryByLabelText('当前密码')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新登录' }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it.each([
    ['old-password', 'NewPassword123', 'different', '两次输入的新密码不一致'],
    ['old-password', 'short', 'short', '新密码长度须为 8–128 位'],
    ['old-password', 'old-password', 'old-password', '新密码不能与当前密码相同'],
  ])('rejects invalid changes before submitting: %s %s %s', (current, next, confirmation, message) => {
    render(<ChangePasswordTab />);
    fillPasswords(current, next, confirmation);
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(changePassword).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('shows incorrect-current-password errors without logging out and allows retry', async () => {
    vi.mocked(changePassword).mockRejectedValueOnce(new Error('当前密码错误'));
    render(<ChangePasswordTab />);
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
    expect((await screen.findByRole('alert')).textContent).toContain('当前密码错误');
    expect(logout).not.toHaveBeenCalled();
    fillPasswords('correct-password');
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
    await screen.findByRole('status');
    expect(changePassword).toHaveBeenLastCalledWith('correct-password', 'NewPassword123');
  });

  it('masks passwords and toggles visibility independently', () => {
    render(<ChangePasswordTab />);
    const current = screen.getByLabelText('当前密码', { exact: true }) as HTMLInputElement;
    const next = screen.getByLabelText('新密码', { exact: true }) as HTMLInputElement;
    expect(current.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '显示当前密码' }));
    expect(current.type).toBe('text');
    expect(next.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '隐藏当前密码' }));
    expect(current.type).toBe('password');
  });

  it('prevents repeated submissions while saving', async () => {
    let resolve!: () => void;
    vi.mocked(changePassword).mockReturnValue(new Promise(done => { resolve = done; }));
    render(<ChangePasswordTab />);
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
    const savingButton = screen.getByRole('button', { name: '修改中...' }) as HTMLButtonElement;
    expect(savingButton.disabled).toBe(true);
    fireEvent.click(savingButton);
    expect(changePassword).toHaveBeenCalledOnce();
    resolve();
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
