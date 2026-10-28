// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpTooltip } from './HelpTooltip';

describe('HelpTooltip', () => {
  afterEach(cleanup);

  it('keeps explanatory text hidden until the question mark is hovered or focused', () => {
    render(<HelpTooltip label="查看指标说明">指标计算口径</HelpTooltip>);

    const trigger = screen.getByRole('button', { name: '查看指标说明' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip').textContent).toBe('指标计算口径');

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip').textContent).toBe('指标计算口径');
  });
});
