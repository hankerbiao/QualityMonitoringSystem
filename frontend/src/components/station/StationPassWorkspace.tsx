import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  datePresetRange,
  matchingDatePreset,
  rankVolumes,
  type StationDatePreset,
  type StationRateBand,
  type StationRateRow,
  type StationRateSummary,
} from '../../utils/stationPassRate';

const datePresets: { id: StationDatePreset; label: string }[] = [
  { id: '7d', label: '近7天' },
  { id: '30d', label: '近30天' },
  { id: 'lastWeek', label: '上周' },
  { id: 'thisMonth', label: '本月' },
  { id: 'lastMonth', label: '上月' },
  { id: 'year', label: '今年' },
];

const bandMeta: Record<StationRateBand, { dot: string; value: string; active: string }> = {
  met: { dot: 'bg-emerald-500', value: 'text-emerald-700', active: '' },
  watch: { dot: 'bg-amber-500', value: 'text-amber-700', active: 'bg-amber-50' },
  alert: { dot: 'bg-red-500', value: 'text-red-700', active: 'bg-red-50' },
};

function rateClass(rate: number): string {
  if (rate >= 98) return 'text-emerald-700';
  if (rate >= 95) return 'text-amber-700';
  return 'text-red-700';
}

function formatCount(value: number): string {
  return value.toLocaleString('zh-CN');
}

function VolumeColumn({
  title,
  items,
  selected,
  loading,
  emptyLabel,
  clearLabel,
  onPick,
}: {
  title: string;
  items: { label: string; count: number }[];
  selected: string;
  loading: boolean;
  emptyLabel: string;
  clearLabel: string;
  onPick: (label: string) => void;
}) {
  const ranking = rankVolumes(items, 10, selected);
  const leader = ranking.visible[0]?.count ?? 0;

  return (
    <div className="min-w-0">
      <div className="px-4 pb-1 pt-3 text-xs font-semibold text-slate-500">{title}</div>
      {loading ? (
        <div className="space-y-3 px-4 py-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-8 animate-pulse rounded-sm bg-slate-100" />
          ))}
        </div>
      ) : ranking.visible.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-slate-400">{emptyLabel}</div>
      ) : (
        <div className="pb-2">
          {selected && (
            <button type="button" onClick={() => onPick('')} className="w-full px-4 py-2 text-left text-xs font-medium text-cyan-700 hover:bg-cyan-50">
              {clearLabel}
            </button>
          )}
          {ranking.visible.map((item) => {
            const share = ranking.total > 0 ? (item.count / ranking.total) * 100 : 0;
            const width = leader > 0 ? (item.count / leader) * 100 : 0;
            const active = selected === item.label;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => onPick(active ? '' : item.label)}
                aria-pressed={active}
                className={`w-full px-4 py-2 text-left transition-colors ${active ? 'bg-cyan-50' : 'hover:bg-slate-50'}`}
              >
                <span className="flex items-baseline gap-2">
                  <span className={`min-w-0 flex-1 truncate text-sm ${active ? 'font-semibold text-cyan-900' : 'text-slate-800'}`} title={item.label}>{item.label}</span>
                  <span className="font-mono text-xs text-slate-700">{formatCount(item.count)}</span>
                  <span className="w-12 text-right font-mono text-[11px] text-slate-400">{share.toFixed(1)}%</span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-sm bg-slate-100">
                  <span className={`block h-full ${active ? 'bg-cyan-700' : 'bg-cyan-600'}`} style={{ width: `${width}%` }} />
                </span>
              </button>
            );
          })}
          {ranking.restCount > 0 && (
            <div className="px-4 py-2 text-[11px] text-slate-400">另有 {formatCount(ranking.restCount)} 项，合计 {formatCount(ranking.restVolume)}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function StationQueryLaunch({
  orderScope,
  models,
  bases,
  loading,
  selectedModel,
  selectedBase,
  dateFrom,
  dateTo,
  stations,
  stationsConfigured,
  onPickModel,
  onPickBase,
  onPickRange,
}: {
  orderScope: 'normal' | 'l6';
  models: { model: string; count: number }[];
  bases: { base: string; count: number }[];
  loading: boolean;
  selectedModel: string;
  selectedBase: string;
  dateFrom: string;
  dateTo: string;
  stations: string[];
  stationsConfigured: boolean;
  onPickModel: (model: string) => void;
  onPickBase: (base: string) => void;
  onPickRange: (from: string, to: string) => void;
}) {
  const today = new Date();
  const activePreset = matchingDatePreset(dateFrom, dateTo, today);
  const total = models.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="border-t border-slate-100 bg-white">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">年度订单产量</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {orderScope === 'l6' ? 'L6 订单' : '普通订单'}
            {!loading && <span className="font-mono text-slate-700"> · {formatCount(total)}</span>}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            统计周期：2026-01-01 至 2026-12-31，按订单计划开始时间（GSTRS）归属年度。
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {datePresets.map((preset) => {
            const active = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const range = datePresetRange(preset.id, today);
                  onPickRange(range.from, range.to);
                }}
                className={`h-8 rounded-md border px-2.5 text-xs ${active ? 'border-cyan-700 bg-cyan-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid border-t border-slate-100 lg:grid-cols-2 lg:divide-x lg:divide-slate-100">
        <VolumeColumn
          title="机型"
          items={models.map((item) => ({ label: item.model, count: item.count }))}
          selected={selectedModel}
          loading={loading}
          emptyLabel="没有机型产量"
          clearLabel="全部机型"
          onPick={onPickModel}
        />
        <VolumeColumn
          title="工厂地点"
          items={bases.map((item) => ({ label: item.base, count: item.count }))}
          selected={selectedBase}
          loading={loading}
          emptyLabel="没有工厂产量"
          clearLabel="全部工厂地点"
          onPick={onPickBase}
        />
      </div>
      {stationsConfigured && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-4 py-3">
          <span className="text-xs font-medium text-slate-500">组合工站</span>
          {stations.length === 0 ? <span className="text-xs text-slate-400">未选择</span> : stations.map((station) => (
            <span key={station} className="rounded-sm bg-cyan-50 px-1.5 py-0.5 font-mono text-[11px] text-cyan-800">{station}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function StationPassFindings({
  summary,
  focus,
  onFocusChange,
  onOpen,
}: {
  summary: StationRateSummary;
  focus: 'all' | 'watch' | 'alert';
  onFocusChange: (focus: 'all' | 'watch' | 'alert') => void;
  onOpen: (rate: StationRateRow) => void;
}) {
  const bands: StationRateBand[] = ['alert', 'watch', 'met'];
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="border-t border-slate-100 bg-white">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-600"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-700">工位分析</span>
          <span className="mt-0.5 block text-xs text-slate-400">工位分布、最低工站和最低工位</span>
        </span>
        <ChevronDown className={`size-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && <div className="grid border-t border-slate-100 lg:grid-cols-[240px_minmax(0,0.9fr)_minmax(0,1.1fr)] lg:divide-x lg:divide-slate-100">
        <div className="px-4 py-3">
          <h3 className="text-xs font-semibold text-slate-500">工位分布</h3>
          <div className="mt-2 space-y-1">
          {bands.map((band) => {
            const meta = bandMeta[band];
            const pressed = band !== 'met' && focus === band;
            const content = (
              <>
                <span className="inline-flex items-center gap-2 text-xs text-slate-600"><i className={`size-2 rounded-full ${meta.dot}`} /></span>
                <span className={`font-mono text-sm font-semibold ${meta.value}`}>{formatCount(summary.counts[band])}</span>
              </>
            );
            if (band === 'met') {
              return <div key={band} className="flex items-center justify-between rounded-sm px-2 py-1.5">{content}</div>;
            }
            return (
              <button
                key={band}
                type="button"
                aria-pressed={pressed}
                onClick={() => onFocusChange(pressed ? 'all' : band)}
                className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition-colors ${pressed ? meta.active : 'hover:bg-slate-50'}`}
              >
                {content}
              </button>
            );
          })}
          </div>
        </div>
        <div className="px-4 py-3">
          <h3 className="text-xs font-semibold text-slate-500">最低工站</h3>
          <ul className="mt-1">
          {summary.stations.map((station) => (
            <li key={station.stationCode} className="flex items-center gap-3 border-b border-slate-100 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs font-semibold text-slate-800" title={station.stationCode}>{station.stationCode}</div>
                {station.stationName && station.stationName !== station.stationCode && <div className="truncate text-[11px] text-slate-400" title={station.stationName}>{station.stationName}</div>}
                {(station.alertCount > 0 || station.watchCount > 0) && (
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {station.alertCount > 0 && <span className="text-red-700">异常 {station.alertCount}</span>}
                    {station.alertCount > 0 && station.watchCount > 0 && <span> · </span>}
                    {station.watchCount > 0 && <span className="text-amber-700">关注 {station.watchCount}</span>}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className={`font-mono text-sm font-semibold ${rateClass(station.passRate)}`}>{station.passRate.toFixed(2)}%</div>
                <div className="font-mono text-[11px] text-slate-400">{formatCount(station.defectCount)}/{formatCount(station.inputCount)}</div>
              </div>
            </li>
          ))}
          </ul>
        </div>
        <div className="px-4 py-3">
          <h3 className="text-xs font-semibold text-slate-500">最低工位</h3>
          <div className="mt-1">
          {summary.lowest.map((row) => (
            <button
              key={`${row.dimensionValue}:${row.stationCode}`}
              type="button"
              onClick={() => onOpen(row)}
              className="flex w-full items-center gap-3 border-b border-slate-100 py-2 text-left last:border-b-0 hover:bg-slate-50"
              title="查看维修与过站明细"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-slate-800" title={row.dimensionValue}>{row.dimensionValue}</div>
                <div className="truncate font-mono text-[11px] text-slate-400">{row.stationCode}{row.stationName && row.stationName !== row.stationCode ? ` · ${row.stationName}` : ''}</div>
              </div>
              <div className="text-right">
                <div className={`font-mono text-sm font-semibold ${rateClass(row.passRate)}`}>{row.passRate.toFixed(2)}%</div>
                <div className="font-mono text-[11px] text-slate-400">{formatCount(row.defectCount)}/{formatCount(row.inputCount)}</div>
              </div>
            </button>
          ))}
          </div>
        </div>
      </div>}
    </section>
  );
}
