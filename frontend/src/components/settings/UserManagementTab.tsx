import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, ShieldCheck, ShieldOff, Trash2, UserCheck, UserX } from 'lucide-react';
import { adminUsersApi, type ManagedUser } from '../../api/adminUsersApi';
import { useAuth } from '../../context/AuthContext';

const PERMISSIONS = [
  ['rty', 'RTY 整机直通率'],
  ['station-pass-rate', '工位过站直通率'],
  ['repair-quality', '维修通过率分析'],
  ['reinsert-rate', '重插率分析'],
  ['lrr', 'LRR 部件故障率'],
  ['process-records', '关键工位影像追溯'],
  ['incoming-materials', '来料异常'],
  ['doa', 'DOA 报修率'],
  ['doa-repairs', 'DOA 维修明细'],
  ['mfr', 'MFR 现网月化故障率'],
] as const;

type EditorState = {
  mode: 'create' | 'edit';
  username: string;
  displayName: string;
  password: string;
  role: ManagedUser['role'];
  originalRole: ManagedUser['role'];
  dashboardPermissions: string[];
  basePermissions: string[] | null;
  originalBasePermissions: string[] | null;
};
const allPermissions = PERMISSIONS.map(([key]) => key);
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const newEditor = (): EditorState => ({
  mode: 'create', username: '', displayName: '', password: '',
  role: 'user', originalRole: 'user', dashboardPermissions: [...allPermissions],
  basePermissions: null, originalBasePermissions: null,
});

function confirmRoleChange(displayName: string, role: ManagedUser['role']) {
  return window.confirm(role === 'admin'
    ? `确定将“${displayName}”设为管理员吗？该用户将获得全部看板、系统配置和用户管理权限。`
    : `确定取消“${displayName}”的管理员身份吗？该用户将恢复原有看板权限。`);
}

export default function UserManagementTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [baseOptions, setBaseOptions] = useState<{ code: string; name: string }[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const currentUsername = currentUser?.username || currentUser?.itcode;
  const canGrantAllBases = currentUser?.basePermissions == null;
  const baseNames = new Map(baseOptions.map(option => [option.code, option.name]));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, options] = await Promise.all([adminUsersApi.list(), adminUsersApi.baseOptions()]);
      setUsers(rows); setBaseOptions(options); setError('');
    }
    catch (err) { setError(err instanceof Error ? err.message : '用户列表加载失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveEditor = async () => {
    const normalizedUsername = editor?.username.trim() ?? '';
    if (saving || !editor || !editor.displayName.trim() || (editor.password && editor.password.length < 8) || (editor.mode === 'create' && (!normalizedUsername || !USERNAME_PATTERN.test(normalizedUsername) || !editor.password))) return;
    const roleChanged = editor.mode === 'edit' && editor.role !== editor.originalRole;
    if (roleChanged && (editor.username === currentUsername || !confirmRoleChange(editor.displayName, editor.role))) return;
    setSaving(true); setError(''); setNotice('');
    try {
      if (editor.mode === 'create') await adminUsersApi.create({ username: normalizedUsername, displayName: editor.displayName.trim(), password: editor.password, dashboardPermissions: editor.dashboardPermissions, basePermissions: editor.basePermissions });
      else await adminUsersApi.update(editor.username, {
        displayName: editor.displayName.trim(),
        ...(roleChanged ? { role: editor.role } : {}),
        ...(editor.role === 'user' && editor.originalRole === 'user' ? { dashboardPermissions: editor.dashboardPermissions } : {}),
        ...(editor.password ? { password: editor.password } : {}),
        ...(JSON.stringify(editor.basePermissions) !== JSON.stringify(editor.originalBasePermissions) ? { basePermissions: editor.basePermissions } : {}),
      });
      setEditor(null); setNotice(editor.mode === 'create' ? '用户创建成功' : '用户资料已更新'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : '用户保存失败'); }
    finally { setSaving(false); }
  };

  const toggleUser = async (user: ManagedUser) => {
    if (saving || user.isProtected || user.username === currentUsername) return;
    const next = !user.isActive;
    if (!next && !window.confirm(`确定禁用用户“${user.displayName}”吗？其当前登录会话将立即失效。`)) return;
    setSaving(true); setError(''); setNotice('');
    try { await adminUsersApi.update(user.username, { isActive: next }); setNotice(next ? '用户已激活' : '用户已禁用'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : '用户状态更新失败'); }
    finally { setSaving(false); }
  };

  const toggleRole = async (user: ManagedUser) => {
    if (saving || user.isProtected || user.username === currentUsername) return;
    const role = user.role === 'admin' ? 'user' : 'admin';
    if (!confirmRoleChange(user.displayName, role)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await adminUsersApi.update(user.username, { role });
      setNotice(role === 'admin' ? '已设为管理员' : '已取消管理员身份');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : '用户角色更新失败'); }
    finally { setSaving(false); }
  };

  const deleteUser = async (user: ManagedUser) => {
    if (saving || user.isProtected || user.username === currentUsername) return;
    if (!window.confirm(`确定删除用户“${user.displayName}”吗？删除后用户将不再显示，当前登录会话也会立即失效。`)) return;
    setSaving(true); setError('');
    try { await adminUsersApi.remove(user.username); setUsers((current) => current.filter((item) => item.username !== user.username)); setNotice('用户已删除'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : '用户删除失败'); }
    finally { setSaving(false); }
  };

  const closeDialogs = () => { if (!saving) setEditor(null); };
  const dialogOpen = Boolean(editor);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h3 className="text-base font-semibold text-slate-900">用户管理</h3>
        <button type="button" disabled={saving} onClick={() => { setError(''); setEditor({ ...newEditor(), basePermissions: currentUser?.basePermissions ?? null }); }} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          <Plus className="size-4" />新建用户
        </button>
      </div>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />加载用户中...</div>
      ) : users.length === 0 ? (
        <div className="border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">暂无用户</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2.5">用户</th>
                <th className="px-3 py-2.5">角色</th>
                <th className="px-3 py-2.5">状态</th>
                <th className="px-3 py-2.5">可访问看板</th>
                <th className="px-3 py-2.5">可访问基地</th>
                <th className="sticky right-0 z-10 border-l border-slate-200 bg-slate-50 px-3 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => {
                const isSelf = user.username === currentUsername;
                const outsideScope = !canGrantAllBases && (user.basePermissions == null || user.basePermissions.some(code => !currentUser?.basePermissions?.includes(code)));
                const protectedAction = user.isProtected || isSelf || outsideScope;
                const protectionTitle = user.isProtected ? '内置管理员账号受保护' : outsideScope ? '该账号包含未授权基地' : '不能对当前账号执行此操作';
                const roleAction = user.role === 'admin' ? '取消管理员' : '设为管理员';
                const roleLabel = user.isProtected ? '内置管理员' : user.role === 'admin' ? '管理员' : '普通用户';
                return (
                  <tr key={user.username} className="text-slate-700">
                    <td className="px-3 py-3">
                      <p className="max-w-40 break-words font-medium">{user.displayName}</p>
                      <p className="mt-0.5 max-w-40 break-all text-xs text-slate-400">{user.username}{isSelf && '（当前账号）'}</p>
                      <p className="mt-1 text-xs text-slate-500 sm:hidden">{roleLabel}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs">
                      {roleLabel}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${user.isActive ? 'text-emerald-700' : 'text-slate-400'}`}>
                        <span className={`size-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        {user.isActive ? '已激活' : '已禁用'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">
                      {user.role === 'admin' || user.dashboardPermissions.length === allPermissions.length ? '全部看板' : `${user.dashboardPermissions.length} 个看板`}
                    </td>
                    <td className="max-w-48 px-3 py-3 text-xs text-slate-500">
                      {user.basePermissions == null ? '全部基地' : user.basePermissions.length ? user.basePermissions.map(code => baseNames.get(code) ?? code).join('、') : '无基地权限'}
                    </td>
                    <td className="sticky right-0 z-[1] border-l border-slate-200 bg-white px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button" title={user.isProtected || outsideScope ? protectionTitle : '编辑用户'} aria-label="编辑用户"
                          disabled={saving || user.isProtected || outsideScope}
                          onClick={() => setEditor({ mode: 'edit', username: user.username, displayName: user.displayName, password: '', role: user.role, originalRole: user.role, dashboardPermissions: [...user.dashboardPermissions], basePermissions: user.basePermissions ?? null, originalBasePermissions: user.basePermissions ?? null })}
                          className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                        ><Pencil className="size-4" /></button>
                        <button
                          type="button" title={protectedAction ? protectionTitle : roleAction} aria-label={roleAction}
                          disabled={saving || protectedAction} onClick={() => void toggleRole(user)}
                          className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >{user.role === 'admin' ? <ShieldOff className="size-4" /> : <ShieldCheck className="size-4" />}</button>
                        <button
                          type="button" title={protectedAction ? protectionTitle : user.isActive ? '禁用用户' : '激活用户'} aria-label={user.isActive ? '禁用用户' : '激活用户'}
                          disabled={saving || protectedAction} onClick={() => void toggleUser(user)}
                          className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >{user.isActive ? <UserX className="size-4" /> : <UserCheck className="size-4" />}</button>
                        <button
                          type="button" title={protectedAction ? protectionTitle : '删除用户'} aria-label="删除用户"
                          disabled={saving || protectedAction} onClick={() => void deleteUser(user)}
                          className="rounded p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                        ><Trash2 className="size-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && editor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4" onClick={closeDialogs}>
          <div role="dialog" aria-modal="true" aria-labelledby="user-editor-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="size-5 text-blue-600" />
              <h4 id="user-editor-title" className="font-semibold text-slate-900">{editor.mode === 'create' ? '新建普通用户' : '编辑用户'}</h4>
            </div>
            <div className="space-y-3">
              <label className="block text-sm text-slate-600">用户名
                <input value={editor.username} disabled={saving || editor.mode === 'edit'} onChange={(event) => setEditor({ ...editor, username: event.target.value })} aria-invalid={editor.mode === 'create' && Boolean(editor.username) && !USERNAME_PATTERN.test(editor.username.trim())} className={`mt-1 h-9 w-full rounded-md border px-2.5 text-slate-800 disabled:bg-slate-50 ${editor.mode === 'create' && editor.username.trim() && !USERNAME_PATTERN.test(editor.username.trim()) ? 'border-red-400' : 'border-slate-300'}`} />
                {editor.mode === 'create' && <span className="mt-1 block text-xs text-slate-500">仅支持英文字母、数字、下划线（_）、点（.）和短横线（-）</span>}
              </label>
              <label className="block text-sm text-slate-600">显示姓名
                <input value={editor.displayName} disabled={saving} onChange={(event) => setEditor({ ...editor, displayName: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2.5 text-slate-800" />
              </label>
              {editor.mode === 'edit' && (
                <label className="block text-sm text-slate-600">角色
                  <select
                    value={editor.role}
                    disabled={saving || editor.username === currentUsername}
                    onChange={(event) => setEditor({ ...editor, role: event.target.value as ManagedUser['role'] })}
                    className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-slate-800 disabled:bg-slate-50"
                  >
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </label>
              )}
              <label className="block text-sm text-slate-600">{editor.mode === 'create' ? '初始密码' : '新密码（可选）'}
                <input type="password" value={editor.password} disabled={saving} onChange={(event) => setEditor({ ...editor, password: event.target.value })} placeholder={editor.mode === 'edit' ? '留空则不修改，至少 8 位' : '至少 8 位密码'} aria-invalid={Boolean(editor.password) && editor.password.length < 8} className={`mt-1 h-9 w-full rounded-md border px-2.5 text-slate-800 ${editor.password && editor.password.length < 8 ? 'border-red-400' : 'border-slate-300'}`} />
                {editor.mode === 'edit' && <span className="mt-1 block text-xs text-slate-500">留空则保留当前密码</span>}
              </label>
              {editor.role === 'admin' ? (
                <p className="text-sm text-slate-600">权限：全部看板、系统配置、用户管理</p>
              ) : editor.originalRole === 'admin' ? (
                <p className="text-sm text-slate-600">可访问看板：恢复原有配置</p>
              ) : (
                <fieldset disabled={saving}>
                  <legend className="mb-2 text-sm text-slate-600">可访问看板</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {PERMISSIONS.map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-xs text-slate-600">
                        <input type="checkbox" checked={editor.dashboardPermissions.includes(key)} onChange={(event) => setEditor({ ...editor, dashboardPermissions: event.target.checked ? [...editor.dashboardPermissions, key] : editor.dashboardPermissions.filter((item) => item !== key) })} />{label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <fieldset disabled={saving} className="border-t border-slate-200 pt-3">
                <legend className="text-sm text-slate-600">可访问基地</legend>
                <label className="block text-sm text-slate-600">基地权限
                  <select
                    value={editor.basePermissions === null ? 'all' : 'selected'}
                    onChange={event => setEditor({ ...editor, basePermissions: event.target.value === 'all' ? null : [] })}
                    className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-slate-800"
                  >
                    <option value="all" disabled={!canGrantAllBases}>全部基地</option>
                    <option value="selected">指定基地</option>
                  </select>
                </label>
                {editor.basePermissions !== null && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {baseOptions.map(({ code, name }) => (
                      <label key={code} className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={editor.basePermissions!.includes(code)}
                          onChange={event => setEditor({ ...editor, basePermissions: event.target.checked ? [...editor.basePermissions!, code] : editor.basePermissions!.filter(value => value !== code) })}
                        />{name}
                      </label>
                    ))}
                  </div>
                )}
                {editor.basePermissions?.length === 0 && <p className="mt-2 text-xs text-amber-700">未选择基地，该用户将无法查看基地数据。</p>}
              </fieldset>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={closeDialogs} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 disabled:opacity-50">取消</button>
              <button type="button" disabled={saving || !editor.displayName.trim() || (editor.mode === 'create' && (!editor.username.trim() || !USERNAME_PATTERN.test(editor.username.trim()) || !editor.password)) || Boolean(editor.password) && editor.password.length < 8} onClick={() => void saveEditor()} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
