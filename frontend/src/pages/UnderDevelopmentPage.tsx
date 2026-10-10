import { ArrowLeft, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';

interface UnderDevelopmentPageProps {
  title: string;
  description: string;
}

export default function UnderDevelopmentPage({ title, description }: UnderDevelopmentPageProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-15 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              to="/"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              aria-label="返回首页"
              title="返回首页"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
              <p className="truncate text-xs text-slate-400">{description}</p>
            </div>
          </div>
          <DashboardSwitcher />
        </div>
      </header>

      <main className="flex min-h-[calc(100vh-60px)] items-center justify-center px-4 py-16">
        <section className="flex max-w-md flex-col items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-400">
            <Clock3 className="size-7" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-slate-700">开发中</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{title}正在开发，暂未开放使用。</p>
        </section>
      </main>
    </div>
  );
}
