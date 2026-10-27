// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardLoading } from './DashboardLoading';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows elapsed time and an honest long-wait message for MFR', () => {
  const { unmount } = render(<DashboardLoading dashboard="MFR" />);
  expect(screen.getByRole('status', { name: '正在加载 MFR 看板数据' })).toBeTruthy();
  expect(screen.getByText('正在读取订单、服务单和换件数据')).toBeTruthy();
  act(() => { vi.advanceTimersByTime(8000); });
  expect(screen.getByText('已等待 8 秒')).toBeTruthy();
  expect(screen.getByText('数据量较大，仍在加载，请稍候')).toBeTruthy();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the DOA loading message unchanged', () => {
  render(<DashboardLoading dashboard="DOA" />);
  expect(screen.getByText('正在汇总所选范围内的数据')).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});
