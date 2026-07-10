import { useState } from 'react';
import { ShieldCheck, Activity, AlertTriangle, PackageCheck, Wrench, Zap, ArrowRight } from 'lucide-react';
import { getOALoginUrl } from '../context/AuthContext';

const modules = [
  { icon: Activity, label: 'RTY 直通率', desc: '整机生产质量实时追踪', color: '#0071e3' },
  { icon: AlertTriangle, label: 'LRR 故障率', desc: '部件故障深度分析', color: '#ff9500' },
  { icon: PackageCheck, label: 'DOA 售后', desc: '客户端质量闭环', color: '#34c759' },
  { icon: Wrench, label: 'MFR 维修', desc: '全链路维修统计', color: '#af52de' },
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  const handleOALogin = () => {
    setLoading(true);
    window.location.href = getOALoginUrl();
  };

  return (
    <div className="min-h-screen flex">
      {/* ===== Left branding panel: aurora gradient ===== */}
      <div className="hidden lg:flex flex-col justify-between w-2/5 relative overflow-hidden animate-aurora bg-[linear-gradient(135deg,#0a1a3f_0%,#102a6b_42%,#0d4a7a_100%)] p-12">
        {/* Floating colored orbs */}
        <div className="absolute -top-40 -right-40 w-[440px] h-[440px] rounded-full bg-[#0071e3]/35 blur-[110px] animate-float-orb" />
        <div className="absolute -bottom-32 -left-24 w-[380px] h-[380px] rounded-full bg-[#06d6f0]/25 blur-[100px] animate-float-orb-alt" />
        <div className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full bg-[#7c3aed]/20 blur-[90px] animate-float-orb" />
        {/* Subtle dot grid */}
        <div
          className="absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage: 'radial-gradient(circle, #9fd0ff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        {/* Top sheen */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_30%)]" />

        {/* Top brand */}
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-16">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center border border-white/15 bg-white/10 backdrop-blur-sm shadow-[0_8px_24px_rgba(0,113,227,0.35)]">
              <ShieldCheck className="w-7 h-7 text-cyan-200" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">QualiBoard</h1>
              <p className="text-sm text-cyan-100/60">品质监控系统</p>
            </div>
          </div>

          <h2 className="text-4xl font-bold text-white leading-tight mb-4 tracking-tight">
            数据驱动的<br />
            <span className="bg-gradient-to-r from-cyan-200 via-sky-300 to-blue-300 bg-clip-text text-transparent">
              品质管理
            </span>
          </h2>
          <p className="text-base text-cyan-50/70 leading-relaxed max-w-sm">
            打通 MES、SAP、SCS 等核心系统，覆盖 RTY/LRR/DOA/MFR 全模块，实现端到端质量监控与自动化预警。
          </p>
        </div>

        {/* Bottom stats */}
        <div className="relative z-10 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: '99.2%', label: '系统可用' },
              { value: '5000+', label: '日订单量' },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl p-4 border border-white/10 bg-white/5 backdrop-blur-sm">
                <div className="text-2xl font-bold text-white mb-1">{s.value}</div>
                <div className="text-xs text-cyan-100/50">{s.label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-cyan-100/30 text-center">© 2026 QualiBoard · v1.0</p>
        </div>
      </div>

      {/* ===== Right login panel ===== */}
      <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden bg-[linear-gradient(135deg,#eef3ff_0%,#f7f9ff_50%,#f5f5f7_100%)]">
        {/* faint ambient blob */}
        <div className="absolute -top-24 -right-24 w-[320px] h-[320px] rounded-full bg-[#0066ff]/10 blur-[90px]" />
        <div className="absolute -bottom-24 -left-16 w-[280px] h-[280px] rounded-full bg-[#06d6f0]/10 blur-[90px]" />

        <div className="w-full max-w-[400px] relative z-10">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-[linear-gradient(135deg,#0d4a7a,#0066ff)]">
              <ShieldCheck className="w-6 h-6 text-cyan-100" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[#0a1a3f]">QualiBoard</h1>
              <p className="text-xs text-[#6b7280]">品质监控系统</p>
            </div>
          </div>

          {/* Login card */}
          <div className="bg-white/90 backdrop-blur-xl rounded-3xl p-10 shadow-[0_20px_60px_-12px_rgba(16,42,107,0.22)] border border-white/60 relative overflow-hidden">
            {/* top shimmer accent */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-[linear-gradient(90deg,#0d4a7a,#0066ff,#06d6f0)]" />
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-2/3 h-10 bg-[#0066ff]/20 blur-2xl rounded-full" />

            <div className="text-center mb-8 relative">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-[linear-gradient(135deg,#0d4a7a,#0066ff)] shadow-[0_10px_24px_rgba(0,102,255,0.35)]">
                <Zap className="w-7 h-7 text-white" strokeWidth={1.5} />
              </div>
              <h2 className="text-2xl font-semibold text-[#0a1a3f] mb-1.5">欢迎使用</h2>
              <p className="text-sm text-[#6b7280]">点击下方按钮通过企业账号登录</p>
            </div>

            <button
              onClick={handleOALogin}
              disabled={loading}
              className="group w-full py-4 bg-[linear-gradient(135deg,#0d4a7a,#0066ff,#0a84ff)] hover:bg-[linear-gradient(135deg,#0f5390,#0077ed,#1e90ff)] disabled:opacity-70 text-white rounded-2xl text-base font-medium transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-[0_10px_28px_rgba(0,102,255,0.40)]"
            >
              {loading ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>验证中...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span>OA 统一登录</span>
                  <ArrowRight className="w-4 h-4 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all duration-200" strokeWidth={2} />
                </>
              )}
            </button>

            <div className="mt-8 pt-6 border-t border-[#e8edf7]">
              <p className="text-[11px] text-[#6b7280] text-center mb-4">支持的监控模块</p>
              <div className="grid grid-cols-2 gap-2">
                {modules.map((m) => (
                  <div key={m.label} className="flex items-center gap-2.5 p-3 bg-[#f5f8ff] rounded-xl border border-[#e8edf7] hover:border-[#c7dcff] transition-colors">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: m.color + '18' }}>
                      <m.icon className="w-3.5 h-3.5" style={{ color: m.color }} strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-[#0a1a3f] leading-tight">{m.label}</p>
                      <p className="text-[9px] text-[#6b7280] leading-snug truncate">{m.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Status indicators */}
          <div className="flex items-center justify-center gap-6 mt-6 text-[11px] text-[#6b7280]">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse" />
              MES
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse" />
              SAP
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse" />
              邮件预警
            </span>
          </div>

          <p className="lg:block hidden text-center text-[11px] text-[#9ca3af] mt-4">
            连续安全运行 47 天 · 最后同步 3 分钟前
          </p>
        </div>
      </div>
    </div>
  );
}