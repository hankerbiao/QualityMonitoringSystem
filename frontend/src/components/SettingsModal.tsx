import { useState, useEffect } from 'react';
import { Settings, Save, BellRing, Target, X, CheckCircle, Loader2, Camera, Users, PanelsTopLeft, RefreshCw, KeyRound } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { ChangePasswordTab, DashboardStatusTab, ModelTargetsTab, EmailAlertTab, ProcessRecordConfigTab, UserManagementTab } from './settings';
import { useAuth } from '../context/AuthContext';
import type { ProcessRecordConfig } from '../types';
import type { HomeModuleStatus } from '../config/homeModules';

interface SettingsModalProps {
  onClose: () => void;
  onSaved: () => void;
}

type TabKey = 'processRecords' | 'rty' | 'email' | 'dashboardStatuses' | 'users' | 'password';

const TABS: { key: TabKey; label: string; icon: typeof Save }[] = [
  { key: 'processRecords', label: '影像数据源', icon: Camera },
  { key: 'rty', label: '机型指标配置', icon: Target },
  { key: 'email', label: '邮件预警规则', icon: BellRing },
  { key: 'dashboardStatuses', label: '看板状态', icon: PanelsTopLeft },
  { key: 'users', label: '用户管理', icon: Users },
  { key: 'password', label: '修改密码', icon: KeyRound },
];

export default function SettingsModal({ onClose, onSaved }: SettingsModalProps) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, []);

  const [activeTab, setActiveTab] = useState<TabKey>('processRecords');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { settings, updateSettings, loading: settingsLoading, error: loadError, reloadSettings } = useSettings();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const visibleTabs = TABS.filter(({ key }) => isAdmin || key === 'rty' || key === 'email' || key === 'password');
  const selectedTab = visibleTabs.some(({ key }) => key === activeTab) ? activeTab : visibleTabs[0].key;

  const [processRecordConfig, setProcessRecordConfig] = useState<ProcessRecordConfig>({ ...settings.processRecords, password: '' });
  const [emailConfig, setEmailConfig] = useState(settings.emailAlert);
  const [modelTargets, setModelTargets] = useState(settings.modelTargets);
  const [dashboardStatuses, setDashboardStatuses] = useState<Record<string, HomeModuleStatus>>(settings.dashboardStatuses);

  useEffect(() => {
    setProcessRecordConfig({ ...settings.processRecords, password: '' });
    setModelTargets(settings.modelTargets);
    setDashboardStatuses(settings.dashboardStatuses);
    setEmailConfig(settings.emailAlert);
  }, [settings]);

  const handleSave = async () => {
    if (saving || settingsLoading || loadError) return;
    setSaving(true);
    setError('');
    try {
      await updateSettings({
        modelTargets,
        emailAlert: emailConfig,
        ...(isAdmin ? {
          processRecords: { username: processRecordConfig.username, password: processRecordConfig.password },
          dashboardStatuses,
        } : {}),
      });
      setSaved(true);
      onSaved();
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '配置保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-4xl h-[600px] max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 shrink-0 bg-white rounded flex items-center justify-center border border-slate-200 shadow-sm">
              <Settings className="w-4 h-4 text-slate-600" />
            </div>
            <div>
              <h2 id="settings-modal-title" className="text-base font-bold text-slate-900 sm:text-lg">系统配置管理</h2>
              <p className="hidden text-xs text-slate-500 sm:block">统一管理系统数据源接入、告警规则及业务指标标准。</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {selectedTab !== 'password' && selectedTab !== 'users' && <button
              onClick={handleSave}
              disabled={saving || settingsLoading || !!loadError}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-sm sm:px-4"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? '保存中...' : '保存配置'}
            </button>}
            <button
              onClick={onClose}
              aria-label="关闭系统配置"
              title="关闭系统配置"
              className="p-1.5 rounded-md hover:bg-slate-200 text-slate-500 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white sm:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 p-2 sm:w-56 sm:flex-col sm:border-b-0 sm:border-r sm:p-3">
            {visibleTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${selectedTab === key ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
              >
                <Icon className={`w-4 h-4 ${selectedTab === key ? 'text-blue-600' : 'text-slate-400'}`} />
                {label}
              </button>
            ))}
          </nav>
          {selectedTab === 'password' ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <ChangePasswordTab />
            </div>
          ) : settingsLoading ? (
            <div className="flex flex-1 items-center justify-center gap-3 text-slate-500" role="status">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>加载配置中...</span>
            </div>
          ) : loadError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
              <p role="alert" className="text-sm text-red-700">{loadError}</p>
              <button onClick={reloadSettings} className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <RefreshCw className="h-4 w-4" />
                重新加载
              </button>
            </div>
          ) : (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {error && <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              {selectedTab === 'processRecords' && (
                <ProcessRecordConfigTab config={processRecordConfig} onChange={setProcessRecordConfig} />
              )}
              {selectedTab === 'rty' && (
                <ModelTargetsTab targets={modelTargets} onChange={setModelTargets} />
              )}
              {selectedTab === 'email' && (
                <EmailAlertTab config={emailConfig} onChange={setEmailConfig} />
              )}
              {selectedTab === 'dashboardStatuses' && (
                <DashboardStatusTab statuses={dashboardStatuses} onChange={setDashboardStatuses} />
              )}
              {selectedTab === 'users' && isAdmin && <UserManagementTab />}
            </div>
          )}
        </div>
      </div>

      {saved && (
        <div className="fixed top-6 right-6 z-[100] bg-green-50 border border-green-200 text-green-800 px-5 py-3 rounded-md shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-right-2 transition-all">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span className="text-sm font-medium">配置已保存</span>
        </div>
      )}
    </div>
  );
}
