import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { alertReportApi } from '../api/alertReport';
import type { AlertReportData, AlertContext } from '../types/alertReport';

function severityStyles(severity: string): { badge: string; banner: string } {
  switch (severity) {
    case '严重':
      return { badge: 'bg-red-600 text-white', banner: 'bg-red-50 border-red-200' };
    case '警告':
      return { badge: 'bg-amber-500 text-white', banner: 'bg-amber-50 border-amber-200' };
    case '提示':
      return { badge: 'bg-slate-500 text-white', banner: 'bg-slate-50 border-slate-200' };
    default:
      return { badge: 'bg-slate-500 text-white', banner: 'bg-slate-50 border-slate-200' };
  }
}

function buildTriggerChips(ctx: AlertContext): string[] {
  const chips: string[] = [];
  if (ctx.productModel) chips.push(`机型 · ${ctx.productModel}`);
  if (ctx.base) chips.push(`基地 · ${ctx.base}`);
  if (ctx.customer) chips.push(`客户 · ${ctx.customer}`);
  if (ctx.dateFrom || ctx.dateTo) {
    chips.push(`时间 · ${ctx.dateFrom || '…'} ~ ${ctx.dateTo || '…'}`);
  }
  if (ctx.salesOrder) chips.push(`销售订单 · ${ctx.salesOrder}`);
  if (ctx.productionOrder) chips.push(`生产订单 · ${ctx.productionOrder}`);
  if (ctx.serialNumber) chips.push(`SN · ${ctx.serialNumber}`);
  return chips;
}

function buildDeepLink(ctx: AlertContext): string {
  const p = new URLSearchParams();
  if (ctx.base) p.set('base', ctx.base);
  if (ctx.productModel) p.set('productModel', ctx.productModel);
  if (ctx.customer) p.set('customer', ctx.customer);
  if (ctx.salesOrder) p.set('salesOrder', ctx.salesOrder);
  if (ctx.productionOrder) p.set('productionOrder', ctx.productionOrder);
  if (ctx.serialNumber) p.set('serialNumber', ctx.serialNumber);
  if (ctx.dateFrom) p.set('dateFrom', ctx.dateFrom);
  if (ctx.dateTo) p.set('dateTo', ctx.dateTo);
  return `/rty?${p.toString()}`;
}

export default function AlertReportPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AlertReportData | null>(null);

  useEffect(() => {
    if (!token) {
      setError('缺少报表令牌');
      setLoading(false);
      return;
    }
    let cancelled = false;
    alertReportApi
      .getReport(token)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '报表加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const styles = useMemo(
    () => (data ? severityStyles(data.context.severity || '严重') : { badge: '', banner: '' }),
    [data]
  );
  const chips = useMemo(() => (data ? buildTriggerChips(data.context) : []), [data]);

  const handleExport = () => {
    if (!data) return;
    const exportData = data.defects.map((d) => ({
      机器SN: d.sn,
      故障类型: d.defectCode,
      故障描述: d.description,
      维修人: d.repairPerson,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '故障明细');
    XLSX.writeFile(wb, `故障明细_${data.context.productModel || 'report'}_${data.generatedAt}.xlsx`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-slate-400">正在加载报表…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-xl font-semibold border border-red-200">
          !
        </div>
        <h1 className="text-base font-semibold text-slate-800">无法打开报表</h1>
        <p className="text-sm text-slate-500 max-w-sm">{error || '链接无效'}</p>
        <button
          onClick={() => navigate('/login')}
          className="mt-2 px-4 py-1.5 bg-white border border-slate-300 rounded-md text-sm text-slate-700 hover:bg-slate-50"
        >
          前往登录
        </button>
      </div>
    );
  }

  const { summary, context } = data;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[720px] mx-auto px-4 py-6">
        {/* 告警头 banner */}
        <div className={`rounded-lg border ${styles.banner} px-5 py-4 flex items-center justify-between mb-4`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center font-semibold text-sm">
              Q
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-800">
                {context.title || '品质告警详情'}
              </h1>
              <p className="text-xs text-slate-500">QualiBoard 品质看板 · 自动生成</p>
            </div>
          </div>
          <div className="text-right">
            <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium ${styles.badge}`}>
              {context.severity || '严重'}
            </span>
            <p className="text-xs text-slate-500 mt-1.5">生成于 {data.generatedAt}</p>
          </div>
        </div>

        {/* KPI 概要 */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-md border border-slate-200 p-3">
            <div className="text-xs text-slate-500">告警类型</div>
            <div className="text-sm font-medium text-slate-800 mt-1">{context.alertType || 'RTY 未达标'}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">整机综合直通率</div>
          </div>
          <div className={`rounded-md border p-3 ${summary.reached ? 'bg-white border-slate-200' : 'bg-red-50 border-red-200'}`}>
            <div className={`text-xs ${summary.reached ? 'text-slate-500' : 'text-red-700'}`}>直通率 (RTY)</div>
            <div className={`text-lg font-medium mt-1 ${summary.reached ? 'text-slate-800' : 'text-red-700'}`}>
              {summary.rtyRate}%
            </div>
            <div className={`text-[11px] mt-0.5 ${summary.reached ? 'text-slate-400' : 'text-red-600'}`}>
              指标 {summary.targetRate}% · {summary.reached ? '达成' : '未达标'}
            </div>
          </div>
          <div className="bg-white rounded-md border border-slate-200 p-3">
            <div className="text-xs text-slate-500">故障数量</div>
            <div className="text-lg font-medium text-slate-800 mt-1">{summary.defectCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">投入 {summary.inputCount} 台</div>
          </div>
          <div className="bg-white rounded-md border border-slate-200 p-3">
            <div className="text-xs text-slate-500">投入数量</div>
            <div className="text-lg font-medium text-slate-800 mt-1">{summary.inputCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">统计周期内</div>
          </div>
        </div>

        {/* 触发条件 */}
        {chips.length > 0 && (
          <div className="bg-white rounded-md border border-slate-200 p-3 mb-4">
            <div className="text-xs text-slate-500 mb-2">触发条件</div>
            <div className="flex flex-wrap gap-2">
              {chips.map((c, i) => (
                <span key={i} className="bg-slate-100 text-slate-600 rounded-md px-2 py-1 text-xs">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 故障明细 */}
        <div className="bg-white rounded-md border border-slate-200 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
            <div className="text-sm font-medium text-slate-800">故障明细</div>
            <div className="text-xs text-slate-500">共 {data.defects.length} 条</div>
          </div>
          {data.defects.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">暂无明细数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f8fafc] border-b border-slate-200 text-slate-600 text-xs">
                  <tr>
                    <th className="px-4 py-2 font-medium w-[22%]">机器SN</th>
                    <th className="px-4 py-2 font-medium w-[16%]">故障类型</th>
                    <th className="px-4 py-2 font-medium w-[44%]">故障描述</th>
                    <th className="px-4 py-2 font-medium w-[18%]">维修人</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {data.defects.map((item) => (
                    <tr key={`${item.id}-${item.sn}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs w-[22%] break-all">{item.sn}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-700 w-[16%]">{item.defectCode}</td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs w-[44%]">{item.description}</td>
                      <td className="px-4 py-2.5 w-[18%]">{item.repairPerson}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 操作区 */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => navigate(buildDeepLink(context))}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            在 QualiBoard 中查看完整看板 →
          </button>
          <button
            onClick={handleExport}
            disabled={data.defects.length === 0}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            导出 Excel 报表
          </button>
        </div>

        {/* 页脚 */}
        <div className="text-xs text-slate-400 text-center pt-3 border-t border-slate-200">
          本页面由系统自动生成 · 数据截至 {data.generatedAt}
          {data.expiresAt ? ` · 链接有效期至 ${data.expiresAt}` : ' · 链接有效期 7 天'}
        </div>
      </div>
    </div>
  );
}
