import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Save } from 'lucide-react';
import { settingsApi } from '../../api/settingsApi';

export function MdmVendorConfigTab() {
  const [cookie, setCookie] = useState('');
  const [hasCookie, setHasCookie] = useState(false);
  const [showCookie, setShowCookie] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    settingsApi.getMdmVendorConfig().then(config => {
      if (active) setHasCookie(config.hasCookie);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : '读取 MDM 配置失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const save = async () => {
    if (!cookie.trim() || saving) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const result = await settingsApi.updateMdmVendorCookie(cookie.trim());
      setHasCookie(result.hasCookie);
      setCookie('');
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存 Cookie 失败');
    } finally {
      setSaving(false);
    }
  };

  return <div className="max-w-2xl space-y-5">
    <div>
      <h3 className="mb-1 text-base font-semibold text-slate-800">MDM 厂商查询</h3>
      <p className="text-sm text-slate-500">输入物料号后系统会查询对应厂商。Cookie 按当前登录用户单独保存并加密。</p>
    </div>
    <div className="space-y-2">
      <label htmlFor="mdm-vendor-cookie" className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <KeyRound className="size-3.5 text-slate-400" /> MDM Cookie
      </label>
      <div className="relative">
        <input
          id="mdm-vendor-cookie"
          type={showCookie ? 'text' : 'password'}
          value={cookie}
          onChange={event => setCookie(event.target.value)}
          placeholder={hasCookie ? 'Cookie 已配置，粘贴新 Cookie 可更新' : '请粘贴浏览器中的 MDM Cookie'}
          autoComplete="new-password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 pr-10 font-mono text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <button type="button" onClick={() => setShowCookie(value => !value)} title={showCookie ? '隐藏 Cookie' : '显示 Cookie'} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          {showCookie ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
      </div>
      <p className="text-xs text-slate-500">{loading ? '正在读取配置…' : hasCookie ? '当前账号已配置 Cookie。若查询提示登录失效，请从 MDM 页面重新复制 Cookie 并保存。' : '当前账号尚未配置 Cookie。'}</p>
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {saved && <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 className="size-4" />Cookie 已保存</p>}
    <button type="button" onClick={save} disabled={loading || saving || !cookie.trim()} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
      {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? '保存中…' : '保存 Cookie'}
    </button>
  </div>;
}
