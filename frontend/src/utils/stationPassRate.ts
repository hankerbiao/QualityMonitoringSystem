export interface StationRateValue {
  passRate: number;
}

export function combinedStationPassRate(
  stationRows: ReadonlyMap<string, StationRateValue>,
  stationCodes: readonly string[],
  onlyAvailable = false,
): number | null {
  if (!stationCodes.length) return null;

  let rate = 1;
  let included = 0;
  for (const stationCode of stationCodes) {
    const station = stationRows.get(stationCode);
    if (!station) {
      if (onlyAvailable) continue;
      return null;
    }
    rate *= station.passRate / 100;
    included += 1;
  }
  return included ? rate * 100 : null;
}

export interface VolumeItem {
  label: string;
  count: number;
}

export interface VolumeRanking {
  visible: VolumeItem[];
  restCount: number;
  restVolume: number;
  total: number;
}

export function rankVolumes(items: readonly VolumeItem[], limit = 10, pinnedLabel = ''): VolumeRanking {
  const sorted = items
    .filter((item) => item.label.trim() && item.count > 0)
    .map((item) => ({ label: item.label.trim(), count: item.count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'));
  const capped = Math.max(0, limit);
  let visible = sorted.slice(0, capped);
  const pinned = pinnedLabel.trim();
  if (pinned && !visible.some((item) => item.label === pinned)) {
    const pinnedItem = sorted.find((item) => item.label === pinned);
    if (pinnedItem) visible = [...visible.slice(0, Math.max(0, capped - 1)), pinnedItem];
  }
  const visibleLabels = new Set(visible.map((item) => item.label));
  const rest = sorted.filter((item) => !visibleLabels.has(item.label));
  return {
    visible,
    restCount: rest.length,
    restVolume: rest.reduce((sum, item) => sum + item.count, 0),
    total: sorted.reduce((sum, item) => sum + item.count, 0),
  };
}

export type StationDatePreset = '7d' | '30d' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'year';

function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function datePresetRange(preset: StationDatePreset, today: Date): { from: string; to: string } {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset === '7d') return { from: formatDateInput(shiftDays(end, -6)), to: formatDateInput(end) };
  if (preset === '30d') return { from: formatDateInput(shiftDays(end, -29)), to: formatDateInput(end) };
  if (preset === 'lastWeek') {
    const daysSinceMonday = (end.getDay() + 6) % 7;
    const lastSunday = shiftDays(end, -daysSinceMonday - 1);
    return {
      from: formatDateInput(shiftDays(lastSunday, -6)),
      to: formatDateInput(lastSunday),
    };
  }
  if (preset === 'thisMonth') {
    return {
      from: formatDateInput(new Date(end.getFullYear(), end.getMonth(), 1)),
      to: formatDateInput(new Date(end.getFullYear(), end.getMonth() + 1, 0)),
    };
  }
  if (preset === 'lastMonth') {
    return {
      from: formatDateInput(new Date(end.getFullYear(), end.getMonth() - 1, 1)),
      to: formatDateInput(new Date(end.getFullYear(), end.getMonth(), 0)),
    };
  }
  return {
    from: formatDateInput(new Date(end.getFullYear(), 0, 1)),
    to: formatDateInput(new Date(end.getFullYear(), 11, 31)),
  };
}

export function matchingDatePreset(from: string, to: string, today: Date): StationDatePreset | null {
  const presets: StationDatePreset[] = ['7d', '30d', 'lastWeek', 'thisMonth', 'lastMonth', 'year'];
  return presets.find((preset) => {
    const range = datePresetRange(preset, today);
    return range.from === from && range.to === to;
  }) ?? null;
}

export type StationRateBand = 'met' | 'watch' | 'alert';

export function stationRateBand(rate: number): StationRateBand {
  if (rate >= 98) return 'met';
  if (rate >= 95) return 'watch';
  return 'alert';
}

export interface StationRateRow {
  dimensionValue: string;
  stationCode: string;
  stationName: string;
  inputCount: number;
  defectCount: number;
  passRate: number;
}

export interface RankedStation {
  stationCode: string;
  stationName: string;
  inputCount: number;
  defectCount: number;
  passRate: number;
  alertCount: number;
  watchCount: number;
}

export interface StationRateSummary {
  counts: Record<StationRateBand, number>;
  stations: RankedStation[];
  lowest: StationRateRow[];
}

export function summarizeStationRates(rows: readonly StationRateRow[], limit = 6): StationRateSummary {
  const counts: Record<StationRateBand, number> = { met: 0, watch: 0, alert: 0 };
  const byStation = new Map<string, RankedStation>();

  rows.forEach((row) => {
    const band = stationRateBand(row.passRate);
    counts[band] += 1;
    const current = byStation.get(row.stationCode) ?? {
      stationCode: row.stationCode,
      stationName: row.stationName,
      inputCount: 0,
      defectCount: 0,
      passRate: 100,
      alertCount: 0,
      watchCount: 0,
    };
    current.inputCount += row.inputCount;
    current.defectCount += row.defectCount;
    if (!current.stationName && row.stationName) current.stationName = row.stationName;
    if (band === 'alert') current.alertCount += 1;
    if (band === 'watch') current.watchCount += 1;
    byStation.set(row.stationCode, current);
  });

  const stations = Array.from(byStation.values()).map((station) => ({
    ...station,
    passRate: station.inputCount > 0 ? ((station.inputCount - station.defectCount) / station.inputCount) * 100 : 100,
  })).sort((left, right) => left.passRate - right.passRate || right.defectCount - left.defectCount || left.stationCode.localeCompare(right.stationCode, 'zh-CN'));

  const lowest = [...rows].sort((left, right) => (
    left.passRate - right.passRate
    || right.defectCount - left.defectCount
    || left.dimensionValue.localeCompare(right.dimensionValue, 'zh-CN')
    || left.stationCode.localeCompare(right.stationCode, 'zh-CN')
  )).slice(0, Math.max(0, limit));

  return { counts, stations: stations.slice(0, Math.max(0, limit)), lowest };
}

export function rowMatchesBand(
  rates: Iterable<StationRateValue>,
  band: Exclude<StationRateBand, 'met'>,
): boolean {
  for (const rate of rates) {
    const current = stationRateBand(rate.passRate);
    if (current === band) return true;
  }
  return false;
}
