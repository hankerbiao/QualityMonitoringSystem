import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Pencil, Plus, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { adminUsersApi, type ManagedUser } from '../../api/adminUsersApi';

const PERMISSIONS = [
  ['rty', 'RTY 整机直通率'],
  ['station-pass-rate', '工位过站直通率'],
  ['lrr', 'LRR 部件故障率'],
  ['process-records', '关键工位影像追溯'],
  ['metadata', '元数据'],
  ['doa', 'DOA 报修率'],
  ['doa-repairs', 'DOA 维修明细'],
  ['mfr', 'MFR 现网月化故障率'],
] as const;

type EditorState = { mode: 'create' | 'edit'; username: string; displayName: string; password: string; dashboardPermissions: string[] };
const allPermissions = PERMISSIONS.map(([key]) => key);
const newEditor = (): EditorState => ({ mode: 'create', username: '', displayName: '', password: '', dashboardPermissions: [...allPermissions] });

export default function UserManagementTab() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await adminUsersApi.list()); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : '用户列表加载失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveEditor = async () => {
    if (!editor || !editor.displayName.trim() || (editor.mode === 'create' && (!editor.username.trim() || !editor.password))) return;
    setSaving(true); setError('');
    try {
      if (editor.mode === 'create') await adminUsersApi.create({ username: editor.username.trim(), displayName: editor.displayName.trim(), password: editor.password, dashboardPermissions: editor.dashboardPermissions });
      else await adminUsersApi.update(editor.username, { displayName: editor.displayName.trim(), dashboardPermissions: editor.dashboardPermissions });
      setEditor(null); setNotice(editor.mode === 'create' ? '用户创建成功' : '用户资料已更新'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : '用户保存失败'); }
    finally { setSaving(false); }
  };

  const toggleUser = async (user: ManagedUser) => {
    const next = !user.isActive;
    if (!next && !window.confirm(`确定禁用用户“${user.displayName}”吗？其当前登录会话将立即失效。`)) return;
    try { await adminUsersApi.update(user.username, { isActive: next }); setNotice(next ? '用户已激活' : '用户已禁用'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : '用户状态更新失败'); }
  };

  const submitReset = async () => {
    if (!resetTarget || resetPassword.length < 8) return;
    setSaving(true);
    try { await adminUsersApi.resetPassword(resetTarget.username, resetPassword); setResetTarget(null); setResetPassword(''); setNotice('密码已重置'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : '密码重置失败'); }
    finally { setSaving(false); }
  };

  const closeDialogs = () => { if (!saving) { setEditor(null); setResetTarget(null); } };
  const dialogOpen = Boolean(editor || resetTarget);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4"><div><h3 className="text-base font-semibold text-slate-900">普通用户管理</h3><p className="mt-1 text-xs text-slate-500">管理账号状态、密码和可访问的质量看板。</p></div><button type="button" onClick={() => { setError(''); setEditor(newEditor()); }} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"><Plus className="size-4" />新建用户</button></div>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
      {loading ? <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />加载用户中...</div> : users.length === 0 ? <div className="border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">暂无普通用户</div> : <div className="overflow-x-auto rounded-md border border-slate-200"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2.5">用户</th><th className="px-3 py-2.5">状态</th><th className="px-3 py-2.5">可访问看板</th><th className="px-3 py-2.5 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((user) => <tr key={user.username} className="text-slate-700"><td className="px-3 py-3"><p className="font-medium">{user.displayName}</p><p className="mt-0.5 text-xs text-slate-400">{user.username}</p></td><td className="px-3 py-3"><span className={`inline-flex items-center gap-1 text-xs font-medium ${user.isActive ? 'text-emerald-700' : 'text-slate-400'}`}><span className={`size-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />{user.isActive ? '已激活' : '已禁用'}</span></td><td className="px-3 py-3 text-xs text-slate-500">{user.dashboardPermissions.length === allPermissions.length ? '全部看板' : `${user.dashboardPermissions.length} 个看板`}</td><td className="px-3 py-3"><div className="flex justify-end gap-1"><button type="button" title="编辑用户" aria-label="编辑用户" onClick={() => setEditor({ mode: 'edit', username: user.username, displayName: user.displayName, password: '', dashboardPermissions: [...user.dashboardPermissions] })} className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-600"><Pencil className="size-4" /></button><button type="button" title="重置密码" aria-label="重置密码" onClick={() => { setResetTarget(user); setResetPassword(''); }} className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-600"><KeyRound className="size-4" /></button><button type="button" title={user.isActive ? '禁用用户' : '激活用户'} aria-label={user.isActive ? '禁用用户' : '激活用户'} onClick={() => void toggleUser(user)} className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-amber-600">{user.isActive ? <UserX className="size-4" /> : <UserCheck className="size-4" />}</button></div></td></tr>)}</tbody></table></div>}

      {dialogOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4" onClick={closeDialogs}><div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>{editor ? <><div className="mb-4 flex items-center gap-2"><ShieldCheck className="size-5 text-blue-600" /><h4 className="font-semibold text-slate-900">{editor.mode === 'create' ? '新建普通用户' : '编辑用户'}</h4></div><div className="space-y-3"><label className="block text-sm text-slate-600">用户名<input value={editor.username} disabled={editor.mode === 'edit'} onChange={(event) => setEditor({ ...editor, username: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2.5 text-slate-800 disabled:bg-slate-50" /></label><label className="block text-sm text-slate-600">显示姓名<input value={editor.displayName} onChange={(event) => setEditor({ ...editor, displayName: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2.5 text-slate-800" /></label>{editor.mode === 'create' && <label className="block text-sm text-slate-600">初始密码<input type="password" value={editor.password} onChange={(event) => setEditor({ ...editor, password: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2.5 text-slate-800" /></label>}<fieldset><legend className="mb-2 text-sm text-slate-600">可访问看板</legend><div className="grid grid-cols-2 gap-2">{PERMISSIONS.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={editor.dashboardPermissions.includes(key)} onChange={(event) => setEditor({ ...editor, dashboardPermissions: event.target.checked ? [...editor.dashboardPermissions, key] : editor.dashboardPermissions.filter((item) => item !== key) })} />{label}</label>)}</div></fieldset></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setEditor(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600">取消</button><button type="button" disabled={saving} onClick={() => void saveEditor()} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? '保存中...' : '保存'}</button></div></> : <><div className="mb-4 flex items-center gap-2"><KeyRound className="size-5 text-blue-600" /><h4 className="font-semibold text-slate-900">重置密码</h4></div><p className="mb-3 text-sm text-slate-500">为“{resetTarget?.displayName}”设置新密码，设置后当前会话会失效。</p><input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="至少 8 位密码" className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm" /><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setResetTarget(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600">取消</button><button type="button" disabled={saving || resetPassword.length < 8} onClick={() => void submitReset()} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? '保存中...' : '确认重置'}</button></div></>}</div></div>}
    </div>
  );
}
