import { useState, useEffect } from 'react';
import { Settings, Save, Database, BellRing, Target, Mail, Key, X, CheckCircle, Mic, ToggleRight } from 'lucide-react';
import { useModelTargets } from '../context/ModelTargetsContext';
import { useSettings } from '../context/SettingsContext';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, []);

  const [activeTab, setActiveTab] = useState<'mes' | 'rty' | 'email' | 'feature'>('mes');
  const [saved, setSaved] = useState(false);
  const { modelTargets: targets, setModelTargets: setTargets } = useModelTargets();
  const { settings, updateSettings } = useSettings();

  const [mesConfig, setMesConfig] = useState({
    username: '',
    password: ''
  });

  const [newModel, setNewModel] = useState('');
  const [newTarget, setNewTarget] = useState('');

  const [emailConfig, setEmailConfig] = useState({
    enabled: true,
    emails: 'manager@company.com; quality-team@company.com',
    attachReport: true
  });

  const handleTargetChange = (model: string, value: string) => {
    const num = parseFloat(value);
    setTargets({
      ...targets,
      [model]: isNaN(num) ? 0 : num
    });
  };

  const handleAddModel = () => {
    if (newModel && newTarget) {
      const num = parseFloat(newTarget);
      if (!isNaN(num)) {
        setTargets({
          ...targets,
          [newModel]: num
        });
        setNewModel('');
        setNewTarget('');
      }
    }
  };

  const handleRemoveModel = (model: string) => {
    const newTargets = { ...targets };
    delete newTargets[model];
    setTargets(newTargets);
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div 
        className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-4xl h-[600px] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        
        <header className="px-6 py-4 flex items-center justify-between border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white rounded flex items-center justify-center border border-slate-200 shadow-sm">
              <Settings className="w-4 h-4 text-slate-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">系统配置管理</h2>
              <p className="text-xs text-slate-500">统一管理系统数据源接入、告警规则及业务指标标准。</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleSave}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Save className="w-4 h-4" />
              保存配置
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-slate-200 text-slate-500 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden bg-white">
          {/* Sidebar Tabs */}
          <div className="w-56 bg-slate-50 border-r border-slate-200 flex flex-col p-3 gap-1">
            <button
              onClick={() => setActiveTab('mes')}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'mes' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Database className={`w-4 h-4 ${activeTab === 'mes' ? 'text-blue-600' : 'text-slate-400'}`} />
              MES 系统接入
            </button>
            <button
              onClick={() => setActiveTab('rty')}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'rty' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Target className={`w-4 h-4 ${activeTab === 'rty' ? 'text-blue-600' : 'text-slate-400'}`} />
              机型指标配置
            </button>
            <button
              onClick={() => setActiveTab('email')}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'email' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <BellRing className={`w-4 h-4 ${activeTab === 'email' ? 'text-blue-600' : 'text-slate-400'}`} />
              邮件预警规则
            </button>
            <button
              onClick={() => setActiveTab('feature')}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'feature' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <ToggleRight className={`w-4 h-4 ${activeTab === 'feature' ? 'text-blue-600' : 'text-slate-400'}`} />
              功能开关
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            
            {activeTab === 'mes' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">MES 系统接入配置</h3>
                  <p className="text-sm text-slate-500 mb-6">配置连接 MES 数据库所需的 API 凭证。</p>
                </div>
                <div className="space-y-4 max-w-lg">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-slate-400" /> 账号
                    </label>
                    <input
                      type="text"
                      value={mesConfig.username}
                      onChange={(e) => setMesConfig({...mesConfig, username: e.target.value})}
                      placeholder="输入 MES 系统账号"
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-slate-400" /> 密码
                    </label>
                    <input
                      type="password"
                      value={mesConfig.password}
                      onChange={(e) => setMesConfig({...mesConfig, password: e.target.value})}
                      placeholder="输入密码"
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                  </div>
                  <div className="pt-2">
                    <p className="text-xs text-slate-500 bg-blue-50/50 text-blue-700/80 px-3 py-2.5 rounded border border-blue-100">
                      注: 该账号用于系统后台定期从 MES (10.8.101.49:9991) 自动拉取 RTY 和 LRR 数据。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'rty' && (
              <div className="space-y-6 h-full flex flex-col">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">直通率标准配置</h3>
                  <p className="text-sm text-slate-500 mb-4">按机型配置 RTY 目标合格率，系统将据此进行达标判定。</p>
                </div>
                
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="border border-slate-200 rounded-md overflow-hidden flex-1 overflow-y-auto mb-4">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium sticky top-0">
                        <tr>
                          <th className="px-4 py-3 border-r border-slate-100 w-1/2">机型名称</th>
                          <th className="px-4 py-3 border-r border-slate-100 w-1/3">直通率标准 (%)</th>
                          <th className="px-4 py-3 text-center w-1/6">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {Object.entries(targets).map(([model, target]) => (
                          <tr key={model} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-2 border-r border-slate-100 font-medium text-slate-800">
                              {model}
                            </td>
                            <td className="px-4 py-2 border-r border-slate-100">
                              <div className="flex items-center gap-2 max-w-[120px]">
                                <input
                                  type="number"
                                  step="0.1"
                                  value={target}
                                  onChange={(e) => handleTargetChange(model, e.target.value)}
                                  className="w-full border border-slate-300 rounded text-right px-2 py-1 text-sm outline-none focus:border-blue-500"
                                />
                                <span className="text-slate-500 font-medium">%</span>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button 
                                onClick={() => handleRemoveModel(model)}
                                className="text-red-500 hover:text-red-700 transition-colors text-xs font-medium"
                              >
                                删除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex items-end gap-3 shrink-0">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">新增机型</label>
                      <input 
                        type="text"
                        placeholder="例如: 6410 X21"
                        value={newModel}
                        onChange={(e) => setNewModel(e.target.value)}
                        className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="w-32">
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">目标 (%)</label>
                      <input 
                        type="number"
                        placeholder="98.5"
                        step="0.1"
                        value={newTarget}
                        onChange={(e) => setNewTarget(e.target.value)}
                        className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <button 
                      onClick={handleAddModel}
                      disabled={!newModel || !newTarget}
                      className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded-md hover:bg-slate-700 transition-colors disabled:opacity-50 h-[34px]"
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'email' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">邮件预警规则</h3>
                  <p className="text-sm text-slate-500 mb-6">配置当直通率低于标准时的邮件预警行为。</p>
                </div>
                
                <div className="space-y-6">
                  <div>
                    <div className="flex items-center gap-3">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={emailConfig.enabled}
                          onChange={(e) => setEmailConfig({...emailConfig, enabled: e.target.checked})}
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                      <span className="text-sm font-medium text-slate-700">启用异常指标邮件预警</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500 ml-14 leading-relaxed max-w-xl">
                      当机型月度生产量或周生产量 &ge; 50台，且实际 RTY 低于设定的目标直通率时，系统将自动触发预警邮件。
                    </p>
                  </div>

                  <div className={!emailConfig.enabled ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
                    <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-slate-400" /> 预警接收人邮箱
                    </label>
                    <textarea 
                      rows={3}
                      value={emailConfig.emails}
                      onChange={(e) => setEmailConfig({...emailConfig, emails: e.target.value})}
                      className="w-full border border-slate-300 rounded-md p-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="manager@company.com; multiple@company.com"
                    />
                    <p className="text-xs text-slate-500 mt-1.5">支持配置多个邮箱，请使用分号 ( ; ) 分隔</p>
                  </div>
                  
                  <div className={!emailConfig.enabled ? 'opacity-50 pointer-events-none' : ''}>
                    <label className="flex items-center gap-2 cursor-pointer w-fit">
                      <input 
                        type="checkbox" 
                        checked={emailConfig.attachReport}
                        onChange={(e) => setEmailConfig({...emailConfig, attachReport: e.target.checked})}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                      />
                      <span className="text-sm text-slate-700">在告警邮件中附带故障明细数据及报表链接</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'feature' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">功能开关配置</h3>
                  <p className="text-sm text-slate-500 mb-6">控制系统中各功能的启用状态。</p>
                </div>
                
                <div className="space-y-6">
                  <div className="p-4 bg-white border border-slate-200 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                          <Mic className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <h4 className="text-sm font-medium text-slate-800">语音输入</h4>
                          <p className="text-xs text-slate-500 mt-0.5">开启后，"数质看板 AI 助手"悬浮球将显示在页面右下角</p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={settings.voiceInputEnabled}
                          onChange={(e) => updateSettings({ voiceInputEnabled: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
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
