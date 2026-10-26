import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { RepairQualitySummary } from '../../types/rty';
import { buildRepairQualityChartData, REPAIR_CHART_COLORS } from '../../utils/repairQualityCharts';

const tickStyle = { fontSize: 10, fill: '#64748b' };
const tooltipStyle = { borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12 };

function shortLabel(value: string) {
  return value.length > 13 ? `${value.slice(0, 12)}…` : value;
}

export function RepairQualityCharts({ summary }: { summary: RepairQualitySummary }) {
  const { composition, distribution, cumulative, ranking } = buildRepairQualityChartData(summary);

  return (
    <section aria-label="维修分析图表" className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 border-b border-slate-200 py-2.5 sm:grid-cols-2 xl:grid-cols-4">
      <figure className="min-w-0">
        <figcaption className="flex min-h-11 items-start justify-between gap-2">
          <div><h2 className="text-xs font-semibold text-slate-800">首修与复修构成</h2><p className="mt-0.5 text-[11px] text-slate-500">维修 SN 占比</p></div>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{summary.snCount.toLocaleString()} 台</span>
        </figcaption>
        <div className="relative h-44" role="img" aria-label="首修与复修构成饼图">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart>
              <Pie data={composition} dataKey="value" nameKey="name" cx="50%" cy="42%" innerRadius={40} outerRadius={59} paddingAngle={2} isAnimationActive={false}>
                {composition.map(entry => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={value => [`${value} 台`, 'SN 数']} />
            </PieChart>
          </ResponsiveContainer>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[54px] text-center">
            <p className="text-lg font-semibold leading-5 tabular-nums text-emerald-800">{summary.firstPassRate.toFixed(1)}%</p>
            <p className="mt-0.5 text-[10px] text-slate-500">首修通过率</p>
          </div>
          <div className="absolute inset-x-0 bottom-1 flex justify-center gap-3 text-[11px] tabular-nums">
            {composition.map(entry => <span key={entry.name} className="inline-flex items-center gap-1 whitespace-nowrap text-slate-600"><span className="size-2 rounded-sm" style={{ backgroundColor: entry.color }} />{entry.name} {summary.snCount ? (entry.value / summary.snCount * 100).toFixed(1) : '0.0'}%</span>)}
          </div>
        </div>
      </figure>

      <figure className="min-w-0">
        <figcaption className="min-h-11"><h2 className="text-xs font-semibold text-slate-800">维修次数分布</h2><p className="mt-0.5 text-[11px] text-slate-500">各次数对应的维修 SN 数</p></figcaption>
        <div className="h-44" role="img" aria-label="维修次数分布柱状图">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={distribution} margin={{ top: 8, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={tickStyle} tickLine={false} axisLine={false} interval={0} />
              <YAxis allowDecimals={false} tick={tickStyle} width={32} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f1f5f9' }} formatter={value => [`${value} 台`, 'SN 数']} />
              <Bar dataKey="snCount" name="SN 数" maxBarSize={25} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {distribution.map((item, index) => <Cell key={item.repairCount} fill={REPAIR_CHART_COLORS[index % REPAIR_CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <figure className="min-w-0">
        <figcaption className="min-h-11"><h2 className="text-xs font-semibold text-slate-800">累计维修次数覆盖率</h2><p className="mt-0.5 text-[11px] text-slate-500">维修次数 ≤ N 的 SN / 全部维修 SN</p></figcaption>
        <div className="h-44" role="img" aria-label="累计维修次数覆盖率折线图">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={cumulative} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={tickStyle} tickLine={false} axisLine={false} interval={0} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={value => `${value}%`} tick={tickStyle} width={38} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={label => `${label}内累计`} formatter={value => [`${Number(value).toFixed(2)}%`, '覆盖率']} />
              <Line type="monotone" dataKey="percentage" name="覆盖率" stroke="#2563eb" strokeWidth={2} dot={{ r: 2.5, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <figure className="min-w-0">
        <figcaption className="min-h-11"><h2 className="text-xs font-semibold text-slate-800">客户 / 基地复修量排行</h2><p className="mt-0.5 text-[11px] text-slate-500">TOP 5 · 按复修 SN 数降序，分组可重叠</p></figcaption>
        <div className="h-44" role="img" aria-label="客户基地复修量排行条形图">
          {ranking.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart layout="vertical" data={ranking} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={tickStyle} allowDecimals={false} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={100} tick={tickStyle} tickFormatter={shortLabel} tickLine={false} axisLine={false} interval={0} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#fff7ed' }} formatter={value => [`${value} 台`, '复修 SN']} />
              <Bar dataKey="repeatCount" name="复修 SN" fill="#ea580c" maxBarSize={16} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer> : <div className="flex h-full items-center justify-center text-xs text-slate-400">暂无客户 / 基地分组</div>}
        </div>
      </figure>
    </section>
  );
}
