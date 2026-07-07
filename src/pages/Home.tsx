import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Activity, 
  AlertTriangle, 
  Wrench, 
  BarChart3,
  ArrowRight,
  Settings,
  ShieldCheck
} from 'lucide-react';
import SettingsModal from '../components/SettingsModal';

export default function Home() {
  const navigate = useNavigate();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-800 p-6 lg:p-12 font-sans selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto space-y-12">
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/20">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">数质看板</h1>
            </div>
            <p className="text-slate-500 max-w-xl leading-relaxed">
              基于 5000 公司销售订单数据，全面打通 MES、SAP、SCS 等核心系统，提供端到端的整机与部件质量监控、深度分析与自动化预警。
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-200">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              系统运行正常
            </div>
          </div>
        </header>

        {/* Main Navigation Modules - Bento Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Main Module: RTY (Takes up more space) */}
          <div 
            onClick={() => navigate('/rty')}
            className="lg:col-span-2 group relative overflow-hidden bg-gradient-to-br from-blue-50 to-white border border-blue-100 hover:border-blue-300 rounded-2xl p-8 cursor-pointer transition-all duration-300 shadow-sm hover:shadow-md hover:shadow-blue-900/5"
          >
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity">
              <Activity className="w-48 h-48 text-blue-900" />
            </div>
            <div className="relative z-10 flex flex-col h-full justify-between">
              <div>
                <div className="w-12 h-12 bg-blue-100 border border-blue-200 rounded-xl flex items-center justify-center mb-6 text-blue-600 group-hover:scale-110 transition-transform">
                  <Activity className="w-6 h-6" />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">RTY (整机综合直通率)</h2>
                <p className="text-slate-600 max-w-md leading-relaxed">
                  依托 MES 销售订单数据，监控普通及复合机型的整体与过站直通率。提供多维度(基地/客户/订单)数据穿透下钻、实际达成与指标对比，并支持邮件自动化预警机制。
                </p>
              </div>
              <div className="mt-8 flex items-center text-blue-600 font-medium group-hover:text-blue-700">
                <span>进入模块</span>
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

          {/* Module: LRR */}
          <div 
            onClick={() => navigate('/lrr')}
            className="group relative overflow-hidden bg-white border border-slate-200 hover:border-amber-300 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:bg-slate-50 hover:shadow-md hover:shadow-amber-900/5"
          >
             <div className="flex flex-col h-full justify-between">
              <div>
                <div className="w-10 h-10 bg-amber-50 border border-amber-100 rounded-lg flex items-center justify-center mb-4 text-amber-600 group-hover:bg-amber-100 transition-colors">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">LRR (工厂阶段部件故障率)</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  基于 MES 生产与维修数据，精准统计工厂阶段各部件维度的故障率(故障部件数/总使用数)。支持按机型、部件类型、PN等维度深层剖析，快速锁定缺陷根因。
                </p>
              </div>
              <div className="mt-6 flex justify-end">
                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-amber-100 text-slate-400 group-hover:text-amber-600 transition-colors border border-slate-100">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>

          {/* Module: DOA */}
          <div 
            onClick={() => navigate('/doa')}
            className="group relative overflow-hidden bg-white border border-slate-200 hover:border-emerald-300 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:bg-slate-50 hover:shadow-md hover:shadow-emerald-900/5"
          >
             <div className="flex flex-col h-full justify-between">
              <div>
                <div className="w-10 h-10 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center justify-center mb-4 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                  <Wrench className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">DOA (开箱报修与换件率)</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  联动 SAP 发货数量与 SCS 报修数据，追踪设备开箱即损状态。细分“DOA报修率”与纯硬件更换的“DOA换件率”，全面评估出厂及物流交付质量。
                </p>
              </div>
              <div className="mt-6 flex justify-end">
                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-emerald-100 text-slate-400 group-hover:text-emerald-600 transition-colors border border-slate-100">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>

          {/* Module: MFR */}
          <div 
            onClick={() => navigate('/mfr')}
            className="group relative overflow-hidden bg-white border border-slate-200 hover:border-purple-300 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:bg-slate-50 hover:shadow-md hover:shadow-purple-900/5"
          >
             <div className="flex flex-col h-full justify-between">
              <div>
                <div className="w-10 h-10 bg-purple-50 border border-purple-100 rounded-lg flex items-center justify-center mb-4 text-purple-600 group-hover:bg-purple-100 transition-colors">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">MFR (现网月化故障率)</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  结合 SCS 换件记录与在保设备体量，计算产品现网月化故障率(当月故障数/在保保有量)，动态呈现各机型产品在全生命周期的现网质量表现。
                </p>
              </div>
              <div className="mt-6 flex justify-end">
                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-purple-100 text-slate-400 group-hover:text-purple-600 transition-colors border border-slate-100">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>

          {/* System Settings / Config */}
          <div 
            onClick={() => setIsSettingsOpen(true)}
            className="group relative overflow-hidden bg-slate-50/50 border border-slate-200/50 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:bg-slate-100/50 hover:shadow-md"
          >
             <div className="flex flex-col h-full justify-center items-center text-center">
              <div className="w-12 h-12 bg-slate-200 border border-slate-300 rounded-full flex items-center justify-center mb-4 text-slate-500 group-hover:rotate-45 transition-transform duration-500">
                <Settings className="w-6 h-6" />
              </div>
              <h3 className="text-slate-700 font-medium group-hover:text-slate-900 transition-colors">系统配置管理</h3>
              <p className="text-slate-500 text-xs mt-2">统一管理系统数据源接入、告警规则及业务指标标准</p>
            </div>
          </div>

        </section>

        {/* Footer info */}
        <footer className="pt-8 border-t border-slate-200 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span>5000公司信息系统开发部</span>
          </div>
          <div>
            有问题请联系 @libiao1
          </div>
        </footer>

      </div>

      {isSettingsOpen && (
        <SettingsModal onClose={() => setIsSettingsOpen(false)} />
      )}
    </div>
  );
}
