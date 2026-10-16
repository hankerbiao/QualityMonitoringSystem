import { useState, type FormEvent } from 'react';
import { CheckCircle, Eye, EyeOff, KeyRound, Loader2, LogIn } from 'lucide-react';
import { changePassword } from '../../api/authApi';
import { useAuth } from '../../context/AuthContext';

export default function ChangePasswordTab() {
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!currentPassword) {
      setError('请输入当前密码');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setError('新密码长度须为 8–128 位');
      return;
    }
    if (newPassword === currentPassword) {
      setError('新密码不能与当前密码相同');
      return;
    }
    if (newPassword !== confirmation) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setVisibleFields({});
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码修改失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="space-y-4">
        <p role="status" className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle className="h-4 w-4 shrink-0" />
          密码已修改，请重新登录。
        </p>
        <button type="button" onClick={logout} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <LogIn className="h-4 w-4" />
          重新登录
        </button>
      </div>
    );
  }

  const fields = [
    { id: 'current-password', label: '当前密码', value: currentPassword, onChange: setCurrentPassword, autoComplete: 'current-password' },
    { id: 'new-password', label: '新密码', value: newPassword, onChange: setNewPassword, autoComplete: 'new-password' },
    { id: 'confirm-password', label: '确认新密码', value: confirmation, onChange: setConfirmation, autoComplete: 'new-password' },
  ];

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-5" noValidate>
      <h3 className="text-base font-semibold text-slate-800">修改密码</h3>
      <input type="text" name="username" autoComplete="username" value={user?.username || user?.itcode || ''} readOnly hidden />
      {fields.map(field => (
        <div key={field.id}>
          <label htmlFor={field.id} className="mb-1.5 block text-sm font-medium text-slate-700">{field.label}</label>
          <div className="relative">
            <input
              id={field.id}
              name={field.id}
              type={visibleFields[field.id] ? 'text' : 'password'}
              value={field.value}
              onChange={event => { field.onChange(event.target.value); setError(''); }}
              autoComplete={field.autoComplete}
              maxLength={128}
              required
              disabled={saving}
              aria-describedby={field.id === 'new-password' ? 'new-password-policy' : undefined}
              className="h-10 w-full rounded-md border border-slate-300 px-3 pr-11 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setVisibleFields(values => ({ ...values, [field.id]: !values[field.id] }))}
              aria-label={`${visibleFields[field.id] ? '隐藏' : '显示'}${field.label}`}
              title={`${visibleFields[field.id] ? '隐藏' : '显示'}${field.label}`}
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              {visibleFields[field.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {field.id === 'new-password' && <p id="new-password-policy" className="mt-1.5 text-xs text-slate-500">8–128 位</p>}
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={saving || !currentPassword || !newPassword || !confirmation}
        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {saving ? '修改中...' : '确认修改'}
      </button>
    </form>
  );
}
