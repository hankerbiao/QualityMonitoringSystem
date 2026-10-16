// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminUsersApi, type ManagedUser } from '../../api/adminUsersApi';
import { useAuth } from '../../context/AuthContext';
import UserManagementTab from './UserManagementTab';

vi.mock('../../api/adminUsersApi', () => ({
  adminUsersApi: { list: vi.fn(), baseOptions: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const admin: ManagedUser = {
  username: 'admin', displayName: '系统管理员', role: 'admin',
  isActive: true, isProtected: true, dashboardPermissions: ['rty'],
};
const alice: ManagedUser = {
  username: 'alice', displayName: 'Alice', role: 'user',
  isActive: true, isProtected: false, dashboardPermissions: ['rty'],
};
const promotedAlice: ManagedUser = {
  ...alice, role: 'admin', dashboardPermissions: ['rty', 'lrr', 'doa'],
};

describe('user administrator roles', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { itcode: 'admin', username: 'admin', role: 'admin' },
      isAuthenticated: true, isAuthLoaded: true, login: vi.fn(), logout: vi.fn(),
    });
    vi.mocked(adminUsersApi.list).mockResolvedValue([admin, alice]);
    vi.mocked(adminUsersApi.baseOptions).mockResolvedValue([
      { code: '1000', name: '天津' }, { code: '3000', name: '昆山' },
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('promotes and demotes an existing user after confirmation', async () => {
    vi.mocked(adminUsersApi.list)
      .mockResolvedValueOnce([admin, alice])
      .mockResolvedValueOnce([admin, promotedAlice])
      .mockResolvedValueOnce([admin, alice]);
    vi.mocked(adminUsersApi.update).mockResolvedValue(promotedAlice);
    render(<UserManagementTab />);
    const row = await screen.findByRole('row', { name: /Alice/ });
    fireEvent.click(within(row).getByRole('button', { name: '设为管理员' }));

    await waitFor(() => expect(adminUsersApi.update).toHaveBeenCalledWith('alice', { role: 'admin' }));
    const promotedRow = await screen.findByRole('row', { name: /Alice.*管理员/ });
    expect(within(promotedRow).getByText('全部看板')).toBeTruthy();
    fireEvent.click(within(promotedRow).getByRole('button', { name: '取消管理员' }));
    await waitFor(() => expect(adminUsersApi.update).toHaveBeenLastCalledWith('alice', { role: 'user' }));
    await screen.findByRole('row', { name: /Alice.*普通用户/ });
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText('已取消管理员身份')).toBeTruthy();
  });

  it('does not send role changes when confirmation is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<UserManagementTab />);
    const row = await screen.findByRole('row', { name: /Alice/ });
    fireEvent.click(within(row).getByRole('button', { name: '设为管理员' }));
    expect(adminUsersApi.update).not.toHaveBeenCalled();
    expect(within(row).getByRole('cell', { name: '普通用户' })).toBeTruthy();
  });

  it('protects the builtin account and the current administrator', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { itcode: 'alice', role: 'admin' },
      isAuthenticated: true, isAuthLoaded: true, login: vi.fn(), logout: vi.fn(),
    });
    vi.mocked(adminUsersApi.list).mockResolvedValue([admin, promotedAlice]);
    render(<UserManagementTab />);
    const builtinRow = await screen.findByRole('row', { name: /系统管理员/ });
    expect(within(builtinRow).getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    const ownRow = screen.getByRole('row', { name: /Alice/ });
    for (const label of ['取消管理员', '禁用用户', '删除用户']) {
      const button = within(ownRow).getByRole('button', { name: label });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect((within(ownRow).getByRole('button', { name: '编辑用户' }) as HTMLButtonElement).disabled).toBe(false);
    expect(adminUsersApi.update).not.toHaveBeenCalled();
    expect(adminUsersApi.remove).not.toHaveBeenCalled();
  });

  it('reports a failed role update and keeps the existing role for retry', async () => {
    vi.mocked(adminUsersApi.update).mockRejectedValueOnce(new Error('无权修改角色'));
    render(<UserManagementTab />);
    const row = await screen.findByRole('row', { name: /Alice/ });
    fireEvent.click(within(row).getByRole('button', { name: '设为管理员' }));
    expect((await screen.findByRole('alert')).textContent).toContain('无权修改角色');
    expect(within(row).getByRole('cell', { name: '普通用户' })).toBeTruthy();
    await waitFor(() => expect((within(row).getByRole('button', { name: '设为管理员' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('keeps original dashboard permissions when editing an administrator', async () => {
    vi.mocked(adminUsersApi.list).mockResolvedValue([admin, promotedAlice]);
    vi.mocked(adminUsersApi.update).mockResolvedValue(promotedAlice);
    render(<UserManagementTab />);
    const row = await screen.findByRole('row', { name: /Alice/ });
    fireEvent.click(within(row).getByRole('button', { name: '编辑用户' }));
    const dialog = screen.getByRole('dialog', { name: '编辑用户' });
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('显示姓名'), { target: { value: 'Alice Updated' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(adminUsersApi.update).toHaveBeenCalledWith('alice', { displayName: 'Alice Updated' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('saves an administrator role selected in the user editor', async () => {
    vi.mocked(adminUsersApi.list)
      .mockResolvedValueOnce([admin, alice])
      .mockResolvedValueOnce([admin, promotedAlice]);
    vi.mocked(adminUsersApi.update).mockResolvedValue(promotedAlice);
    render(<UserManagementTab />);
    const row = await screen.findByRole('row', { name: /Alice/ });
    fireEvent.click(within(row).getByRole('button', { name: '编辑用户' }));
    const dialog = screen.getByRole('dialog', { name: '编辑用户' });
    fireEvent.change(within(dialog).getByLabelText('角色'), { target: { value: 'admin' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await screen.findByRole('row', { name: /Alice.*管理员/ });
    expect(adminUsersApi.update).toHaveBeenCalledWith('alice', {
      displayName: 'Alice', role: 'admin',
    });
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the editor open without saving when role confirmation is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<UserManagementTab />);
    const row = await screen.findByRole('row', { name: /Alice/ });
    fireEvent.click(within(row).getByRole('button', { name: '编辑用户' }));
    const dialog = screen.getByRole('dialog', { name: '编辑用户' });
    fireEvent.change(within(dialog).getByLabelText('角色'), { target: { value: 'admin' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(adminUsersApi.update).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(within(row).getByRole('cell', { name: '普通用户' })).toBeTruthy();
  });

  it('does not overwrite stored dashboard permissions when demoting in the editor', async () => {
    vi.mocked(adminUsersApi.list)
      .mockResolvedValueOnce([admin, promotedAlice])
      .mockResolvedValueOnce([admin, alice]);
    vi.mocked(adminUsersApi.update).mockResolvedValue(alice);
    render(<UserManagementTab />);
    const row = await screen.findByRole('row', { name: /Alice/ });
    fireEvent.click(within(row).getByRole('button', { name: '编辑用户' }));
    const dialog = screen.getByRole('dialog', { name: '编辑用户' });
    fireEvent.change(within(dialog).getByLabelText('角色'), { target: { value: 'user' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await screen.findByRole('row', { name: /Alice.*普通用户/ });
    expect(adminUsersApi.update).toHaveBeenCalledWith('alice', {
      displayName: 'Alice', role: 'user',
    });
  });

  it('disables role changes when editing the current administrator', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { itcode: 'alice', role: 'admin' },
      isAuthenticated: true, isAuthLoaded: true, login: vi.fn(), logout: vi.fn(),
    });
    vi.mocked(adminUsersApi.list).mockResolvedValue([admin, promotedAlice]);
    render(<UserManagementTab />);
    const row = await screen.findByRole('row', { name: /Alice/ });
    fireEvent.click(within(row).getByRole('button', { name: '编辑用户' }));
    expect((screen.getByLabelText('角色') as HTMLSelectElement).disabled).toBe(true);
  });

  it('disables duplicate operations while a role change is pending', async () => {
    let resolve!: (value: ManagedUser) => void;
    vi.mocked(adminUsersApi.update).mockReturnValue(new Promise(done => { resolve = done; }));
    render(<UserManagementTab />);
    const row = await screen.findByRole('row', { name: /Alice/ });
    const button = within(row).getByRole('button', { name: '设为管理员' });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(adminUsersApi.update).toHaveBeenCalledTimes(1);
    resolve(promotedAlice);
    await waitFor(() => expect(screen.getByText('已设为管理员')).toBeTruthy());
  });

  it('lets administrators assign bases to another administrator', async () => {
    vi.mocked(adminUsersApi.list).mockResolvedValue([admin, promotedAlice]);
    vi.mocked(adminUsersApi.update).mockResolvedValue({ ...promotedAlice, basePermissions: ['1000'] });
    render(<UserManagementTab />);
    fireEvent.click(within(await screen.findByRole('row', { name: /Alice/ })).getByRole('button', { name: '编辑用户' }));
    const dialog = screen.getByRole('dialog', { name: '编辑用户' });
    fireEvent.change(within(dialog).getByLabelText('基地权限'), { target: { value: 'selected' } });
    expect(within(dialog).getByText('未选择基地，该用户将无法查看基地数据。')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '天津' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(adminUsersApi.update).toHaveBeenCalledWith('alice', {
      displayName: 'Alice', basePermissions: ['1000'],
    }));
  });

  it('restores all bases explicitly with null', async () => {
    vi.mocked(adminUsersApi.list).mockResolvedValue([admin, { ...alice, basePermissions: ['1000'] }]);
    vi.mocked(adminUsersApi.update).mockResolvedValue({ ...alice, basePermissions: null });
    render(<UserManagementTab />);
    fireEvent.click(within(await screen.findByRole('row', { name: /Alice/ })).getByRole('button', { name: '编辑用户' }));
    const dialog = screen.getByRole('dialog', { name: '编辑用户' });
    fireEvent.change(within(dialog).getByLabelText('基地权限'), { target: { value: 'all' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(adminUsersApi.update).toHaveBeenCalledWith('alice', {
      displayName: 'Alice', dashboardPermissions: ['rty'], basePermissions: null,
    }));
  });

  it('limits a scoped administrator to their own bases and protects broader accounts', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { itcode: 'manager', role: 'admin', basePermissions: ['1000'] },
      isAuthenticated: true, isAuthLoaded: true, login: vi.fn(), logout: vi.fn(),
    });
    vi.mocked(adminUsersApi.list).mockResolvedValue([
      admin, { ...alice, basePermissions: ['1000'] }, { ...alice, username: 'broader', displayName: 'Broader', basePermissions: null },
    ]);
    vi.mocked(adminUsersApi.baseOptions).mockResolvedValue([{ code: '1000', name: '天津' }]);
    render(<UserManagementTab />);
    const broader = await screen.findByRole('row', { name: /Broader/ });
    expect(within(broader).getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(within(screen.getByRole('row', { name: /Alice/ })).getByRole('button', { name: '编辑用户' }));
    const dialog = screen.getByRole('dialog', { name: '编辑用户' });
    expect((within(dialog).getByRole('option', { name: '全部基地' }) as HTMLOptionElement).disabled).toBe(true);
    expect(within(dialog).getByRole('checkbox', { name: '天津' })).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox', { name: '昆山' })).toBeNull();
  });
});
