import { useState, type FormEvent } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Eye,
  EyeOff,
  Gauge,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import appPackage from '../../package.json';

const qualityModules = [
  { icon: Gauge, code: 'RTY', label: '整机直通率', status: '在线' },
  { icon: Activity, code: 'LRR', label: '部件故障率', status: '在线' },
  { icon: Boxes, code: 'DOA', label: '开箱报修率', status: '建设中' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-[100dvh] bg-[#f4f6f8] lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.92fr)]">
      <section className="relative hidden overflow-hidden bg-[#122125] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.55) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="absolute left-0 top-0 h-1.5 w-32 bg-[#d7ff55]" />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white/5">
              <ShieldCheck className="h-6 w-6 text-[#d7ff55]" strokeWidth={1.7} />
            </div>
            <div>
              <p className="text-lg font-semibold">QualiBoard</p>
              <p className="text-xs text-white/55">品质监控系统</p>
            </div>
          </div>

          <div className="mt-20 max-w-xl">
            <p className="mb-5 flex items-center gap-2 text-sm font-medium text-[#d7ff55]">
              <span className="h-2 w-2 bg-[#d7ff55]" />
              QUALITY OPERATIONS
            </p>
            <h1 className="text-5xl font-semibold leading-[1.16] xl:text-[56px]">
              让每一项质量数据
              <br />
              都能推动行动
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-white/62">
              汇聚生产、故障与维修数据，为质量团队提供统一、及时、可追溯的决策视图。
            </p>
          </div>
        </div>

        <div className="relative z-10">
          <div className="mb-4 flex items-center justify-between border-b border-white/12 pb-3 text-xs text-white/45">
            <span>监控模块</span>
            <span>系统状态</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {qualityModules.map((module) => (
              <div key={module.code} className="border-l-2 border-white/15 py-2 pl-3">
                <div className="mb-4 flex items-center justify-between">
                  <module.icon className="h-4 w-4 text-white/55" strokeWidth={1.7} />
                  <span
                    className={`text-[11px] ${module.status === '在线' ? 'text-[#d7ff55]' : 'text-white/35'}`}
                  >
                    {module.status}
                  </span>
                </div>
                <p className="text-lg font-semibold">{module.code}</p>
                <p className="mt-1 text-xs text-white/48">{module.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex min-h-[100dvh] items-center justify-center px-5 py-10 sm:px-10 lg:bg-white lg:px-12">
        <div className="login-enter w-full max-w-[400px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#122125]">
              <ShieldCheck className="h-5 w-5 text-[#d7ff55]" strokeWidth={1.7} />
            </div>
            <div>
              <p className="font-semibold text-[#122125]">QualiBoard</p>
              <p className="text-xs text-[#667378]">品质监控系统</p>
            </div>
          </div>

          <header className="mb-8">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-[#dbe2e4] bg-[#f7f9f9]">
              <LockKeyhole className="h-5 w-5 text-[#19766f]" strokeWidth={1.8} />
            </div>
            <h2 className="text-[28px] font-semibold leading-tight text-[#122125]">登录质量监控平台</h2>
            <p className="mt-2 text-sm leading-6 text-[#667378]">请输入系统用户名和密码继续访问。</p>
          </header>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="username" className="mb-2 block text-sm font-medium text-[#25383d]">
                用户名
              </label>
              <div className="relative">
                <UserRound
                  className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#7f8d91]"
                  strokeWidth={1.7}
                />
                <input
                  id="username"
                  name="username"
                  type="text"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setError('');
                  }}
                  autoComplete="username"
                  autoFocus
                  required
                  aria-invalid={Boolean(error)}
                  className="h-12 w-full rounded-lg border border-[#cfd8da] bg-white pl-11 pr-4 text-[15px] text-[#122125] outline-none transition focus:border-[#19766f] focus:ring-4 focus:ring-[#19766f]/10"
                  placeholder="请输入用户名"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-[#25383d]">
                密码
              </label>
              <div className="relative">
                <LockKeyhole
                  className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#7f8d91]"
                  strokeWidth={1.7}
                />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError('');
                  }}
                  autoComplete="current-password"
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="h-12 w-full rounded-lg border border-[#cfd8da] bg-white pl-11 pr-12 text-[15px] text-[#122125] outline-none transition focus:border-[#19766f] focus:ring-4 focus:ring-[#19766f]/10"
                  placeholder="请输入密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#667378] transition hover:bg-[#eef2f2] hover:text-[#122125] focus:outline-none focus:ring-2 focus:ring-[#19766f]/30"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  title={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                id="login-error"
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-[#efc7c1] bg-[#fff5f3] px-3.5 py-3 text-sm text-[#a13a2f]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#19766f] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(25,118,111,0.18)] transition hover:bg-[#135f59] focus:outline-none focus:ring-4 focus:ring-[#19766f]/20 active:translate-y-px disabled:cursor-not-allowed disabled:bg-[#9aacaa] disabled:shadow-none"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                  正在登录
                </>
              ) : (
                <>
                  登录系统
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 rounded-lg border border-[#e6dfb8] bg-[#fffceb] px-4 py-3.5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#7b721e]" strokeWidth={1.8} />
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#5e581d]">默认登录信息</p>
                <p className="mt-1.5 break-words font-mono text-xs text-[#746c24]">
                  用户名 <strong className="text-[#403b11]">admin</strong>
                  <span className="mx-2 text-[#b2a94f]">|</span>
                  密码 <strong className="text-[#403b11]">admin123</strong>
                </p>
              </div>
            </div>
          </div>

          <footer className="mt-8 flex items-center justify-between border-t border-[#e2e7e8] pt-5 text-xs text-[#7b888c]">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#3bb273]" />
              服务运行正常
            </span>
            <span>QualiBoard v{appPackage.version}</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
