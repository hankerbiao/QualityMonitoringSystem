// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateRangePicker } from './DateRangePicker';

describe('DateRangePicker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 26, 12));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  const setup = (disabled = false) => {
    const onChange = vi.fn();
    render(<DateRangePicker label="实际开始日期（订单）" from="2026-09-27" to="2026-10-26" onChange={onChange} disabled={disabled} />);
    const trigger = screen.getByRole('button', { name: '实际开始日期（订单）' });
    fireEvent.click(trigger);
    return { onChange, trigger };
  };

  it('shows one collapsed control and selects a preset with both date bounds', () => {
    const { onChange, trigger } = setup();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '近 30 天' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '近 7 天' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-10-20', '2026-10-26');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('validates custom ranges before committing, including empty dates', () => {
    const { onChange } = setup();
    const start = screen.getByLabelText('开始日期');
    fireEvent.change(start, { target: { value: '2026-11-01' } });
    expect(screen.getByRole('alert').textContent).toContain('开始日期不能晚于结束日期');
    expect((screen.getByRole('button', { name: '确定' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(start, { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toContain('请选择完整的起止日期');
    fireEvent.change(start, { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-10-05', '2026-10-05');
  });

  it('supports optional bounds and clearing when explicitly enabled', () => {
    const onChange = vi.fn();
    render(<DateRangePicker label="计划日期" from="" to="" allowOpenEnded onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: '计划日期' });
    expect(trigger.textContent).toContain('不限');
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01', '');
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-01' } });
    expect((screen.getByRole('button', { name: '确定' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '清除日期' }));
    expect(onChange).toHaveBeenLastCalledWith('', '');
  });

  it('discards drafts on cancel, Escape or outside click and restores focus on Escape', () => {
    const { onChange, trigger } = setup();
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('2026-09-27');
    fireEvent.keyDown(screen.getByLabelText('开始日期'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reuses the month picker for an exact whole-month custom selection', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: '展开月份快捷筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('2026-02-01');
    expect((screen.getByLabelText('结束日期') as HTMLInputElement).value).toBe('2026-02-28');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-02-01', '2026-02-28');
  });

  it('confirms a valid date draft with Enter without submitting the outer form', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } });
    fireEvent.keyDown(screen.getByLabelText('结束日期'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-10-01', '2026-10-26');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open a disabled control', () => {
    setup(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
