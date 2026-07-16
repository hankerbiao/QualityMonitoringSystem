import { useEffect, useState } from 'react';
import { Database, Loader2, AlertCircle, Building2, Users, Package, Wrench, Factory, Hash } from 'lucide-react';
import { settingsApi } from '../../api/settingsApi';
import type { DataSummary } from '../../types';
import FaultListModal from '../FaultListModal';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  onClick?: () => void;
}

function StatCard({ icon, label, value, sub, onClick }: StatCardProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={`bg-white border border-slate-200 rounded-lg px-5 py-4 flex items-start gap-4 overflow-hidden ${onClick ? 'cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all text-left w-full' : ''}`}
    >
      <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-500 mb-0.5 truncate">{label}</div>
        <div className="text-2xl font-bold text-slate-800 tabular-nums truncate">{typeof value === 'number' ? value.toLocaleString() : value}</div>
        {sub && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</div>}
      </div>
    </Comp>
  );
}

interface TagBadgeProps {
  children: string;
}

function TagBadge({ children }: TagBadgeProps) {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
      {children}
    </span>
  );
}

export function DataOverviewTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DataSummary | null>(null);
  const [showFaults, setShowFaults] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    settingsApi
      .getDataSummary()
      .then((d) => {
        if (mounted) setData(d);
      })
      .catch((err) => {
        if (mounted) setError(err?.message || '加载失败');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载数据概览...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4" />
          加载失败：{error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-500" />
          数据概览
        </h3>
        <p className="text-sm text-slate-500">
          系统当前数据汇总统计，数据来源于 <code className="text-slate-600">machine_info</code>、<code className="text-slate-600">fault_info</code>、<code className="text-slate-600">sales_orders</code>、<code className="text-slate-600">assembly_records</code> 集合。
        </p>
      </div>

      {/* 核心统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Hash className="w-5 h-5 text-blue-600" />}
          label="销售订单数"
          value={data.totalOrders}
          sub={`有效 ${data.validOrders} 单`}
        />
        <StatCard
          icon={<Database className="w-5 h-5 text-blue-600" />}
          label="总机器数"
          value={data.totalMachines}
        />
        <StatCard
          icon={<Package className="w-5 h-5 text-blue-600" />}
          label="总机型数"
          value={data.totalModelTypes}
        />
        <StatCard
          icon={<Package className="w-5 h-5 text-emerald-600" />}
          label="总物料数"
          value={data.totalMaterials}
          sub="装配物料编码"
        />
        <StatCard
          icon={<Wrench className="w-5 h-5 text-red-600" />}
          label="故障数量"
          value={data.totalFaults}
          onClick={() => setShowFaults(true)}
        />
        <StatCard
          icon={<Wrench className="w-5 h-5 text-orange-600" />}
          label="总故障物料数"
          value={data.totalFaultMaterials}
          sub="有故障的物料种类"
        />
        <StatCard
          icon={<Building2 className="w-5 h-5 text-purple-600" />}
          label="基地"
          value={data.factories.length}
          sub={data.factories.join(' · ')}
        />
        <StatCard
          icon={<Users className="w-5 h-5 text-indigo-600" />}
          label="客户"
          value={data.customers.length}
          sub={data.customers.length > 0 ? data.customers.join(' · ') : '暂无'}
        />
      </div>

      {/* 基地明细 */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
          <Factory className="w-4 h-4 text-slate-500" />
          生产基地
        </h4>
        <div className="flex flex-wrap gap-2">
          {data.factories.length > 0 ? (
            data.factories.map((f) => <TagBadge key={f}>{f}</TagBadge>)
          ) : (
            <span className="text-sm text-slate-400">暂无数据</span>
          )}
        </div>
      </div>

      {/* 客户明细 */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-slate-500" />
          客户列表
        </h4>
        <div className="flex flex-wrap gap-2">
          {data.customers.length > 0 ? (
            data.customers.map((c) => <TagBadge key={c}>{c}</TagBadge>)
          ) : (
            <span className="text-sm text-slate-400">暂无数据</span>
          )}
        </div>
      </div>

      {showFaults && <FaultListModal onClose={() => setShowFaults(false)} />}
    </div>
  );
}