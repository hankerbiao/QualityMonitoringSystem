import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { RepairQualitySummary } from '../../types/rty';
import { buildRepairQualityChartData, REPAIR_CHART_COLORS } from '../../utils/repairQualityCharts';

const tickStyle = { fontSize: 10, fill: '#64748b' };
const tooltipStyle = { borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12 };

export function RepairQualityCharts({ summary }: { summary: RepairQualitySummary }) {
  const { composition, distribution } = buildRepairQualityChartData(summary);

  return (
    <section aria-label="维修分析图表" className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 border-b border-slate-200 py-2.5 sm:grid-cols-2 xl:grid-cols-3">
      <figure className="min-w-0">
        <figcaption className="flex min-h-11 items-start justify-between gap-2">
          <div><h2 className="text-xs font-semibold text-slate-800">首修与复修构成</h2><p className="mt-0.5 text-[11px] text-slate-500">维修 SN 占比</p></div>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{summary.snCount.toLocaleString()} 台</span>
        </figcaption>
        <div className="relative h-36" role="img" aria-label="按维修次数划分的首修与复修构成饼图">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart>
              <Pie data={composition} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={59} isAnimationActive={false}>
                {composition.map(entry => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={value => [`${value} 台`, 'SN 数']} />
            </PieChart>
          </ResponsiveContainer>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[54px] text-center">
            <p className="text-lg font-semibold leading-5 tabular-nums text-emerald-800">{summary.firstPassRate.toFixed(1)}%</p>
            <p className="mt-0.5 text-[10px] text-slate-500">首修通过率</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] tabular-nums">
          {composition.map(entry => <span key={entry.name} className="inline-flex items-center gap-1 whitespace-nowrap text-slate-600"><span className="size-2 rounded-sm" style={{ backgroundColor: entry.color }} />{entry.name} {entry.percentage.toFixed(1)}%</span>)}
        </div>
      </figure>

      <figure className="min-w-0 xl:col-span-2">
        <figcaption className="flex min-h-11 flex-wrap items-start justify-between gap-x-2">
          <div><h2 className="text-xs font-semibold text-slate-800">维修次数分布</h2><p className="mt-0.5 text-[11px] text-slate-500">各次数对应的维修 SN 数和占比</p></div>
          <div className="flex gap-3 text-[11px] text-slate-600"><span>柱形：SN 数</span><span className="text-blue-700">折线：占比</span></div>
        </figcaption>
        <div className="h-44" role="img" aria-label="维修次数分布数量及占比组合图">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart data={distribution} margin={{ top: 8, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={tickStyle} tickLine={false} axisLine={false} interval={0} />
              <YAxis yAxisId="count" allowDecimals={false} tick={tickStyle} width={32} tickLine={false} axisLine={false} />
              <YAxis yAxisId="percentage" orientation="right" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={value => `${value}%`} tick={tickStyle} width={38} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f1f5f9' }} formatter={(value, name) => name === '占比' ? [`${Number(value).toFixed(2)}%`, name] : [`${value} 台`, name]} />
              <Bar yAxisId="count" dataKey="snCount" name="SN 数" maxBarSize={25} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {distribution.map((item, index) => <Cell key={item.repairCount} fill={REPAIR_CHART_COLORS[index % REPAIR_CHART_COLORS.length]} />)}
              </Bar>
              <Line yAxisId="percentage" type="monotone" dataKey="percentage" name="占比" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 2.5, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </section>
  );
}
