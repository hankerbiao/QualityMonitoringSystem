// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { RepairQualityCharts } from './RepairQualityCharts';

vi.mock('recharts', () => {
  const container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: container, PieChart: container, Pie: container, BarChart: container,
    ComposedChart: container, CartesianGrid: () => null, Cell: () => null, XAxis: () => null,
    YAxis: ({ yAxisId, orientation, domain }: { yAxisId?: string; orientation?: string; domain?: number[] }) => (
      <span data-testid={`axis-${yAxisId}`} data-orientation={orientation} data-domain={domain?.join(',')} />
    ),
    Bar: ({ dataKey, yAxisId }: { dataKey: string; yAxisId?: string }) => (
      <span data-testid="bar" data-key={dataKey} data-axis={yAxisId} />
    ),
    Line: ({ dataKey, yAxisId }: { dataKey: string; yAxisId: string }) => (
      <span data-testid="line" data-key={dataKey} data-axis={yAxisId} />
    ),
    Tooltip: () => null,
  };
});

afterEach(cleanup);

it('plots repair counts and per-bucket percentages on separate axes', () => {
  render(<RepairQualityCharts summary={{
    snCount: 10, firstPassCount: 5, repeatCount: 5, firstPassRate: 50,
    distribution: [
      { repairCount: '1', snCount: 5, percentage: 50 },
      { repairCount: '9+', snCount: 2, percentage: 20 },
    ],
    groups: [],
  }} />);

  const chart = within(screen.getByRole('img', { name: '维修次数分布数量及占比组合图' }));
  expect(chart.getByTestId('bar').getAttribute('data-key')).toBe('snCount');
  expect(chart.getByTestId('bar').getAttribute('data-axis')).toBe('count');
  expect(chart.getByTestId('line').getAttribute('data-key')).toBe('percentage');
  expect(chart.getByTestId('line').getAttribute('data-axis')).toBe('percentage');
  expect(chart.getByTestId('axis-percentage').getAttribute('data-orientation')).toBe('right');
  expect(chart.getByTestId('axis-percentage').getAttribute('data-domain')).toBe('0,100');
  expect(screen.getByText('1次 50.0%')).toBeTruthy();
  expect(screen.getByText('9次+ 20.0%')).toBeTruthy();
  expect(screen.queryByText('累计维修次数覆盖率')).toBeNull();
  expect(screen.queryByText('客户 / 基地复修量排行')).toBeNull();
});
