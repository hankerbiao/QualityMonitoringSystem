export interface DateRange {
  from: string;
  to: string;
}

export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function recentDateRange(days = 30, now = new Date()): DateRange {
  return {
    from: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1)),
    to: formatLocalDate(now),
  };
}

export function dateRangePresets(now = new Date()): (DateRange & { label: string })[] {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const monday = day - (now.getDay() + 6) % 7;
  const range = (from: Date, to = now): DateRange => ({ from: formatLocalDate(from), to: formatLocalDate(to) });
  return [
    { label: '今天', ...recentDateRange(1, now) },
    { label: '昨天', ...range(new Date(year, month, day - 1), new Date(year, month, day - 1)) },
    { label: '近 7 天', ...recentDateRange(7, now) },
    { label: '近 30 天', ...recentDateRange(30, now) },
    { label: '本周', ...range(new Date(year, month, monday)) },
    { label: '上周', ...range(new Date(year, month, monday - 7), new Date(year, month, monday - 1)) },
    { label: '本月', ...range(new Date(year, month, 1)) },
    { label: '上月', ...range(new Date(year, month - 1, 1), new Date(year, month, 0)) },
    { label: '本季度', ...range(new Date(year, Math.floor(month / 3) * 3, 1)) },
    { label: '今年', ...range(new Date(year, 0, 1)) },
  ];
}
