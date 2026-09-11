import { describe, expect, it } from 'vitest';
import { combinedStationPassRate } from './stationPassRate';

describe('combinedStationPassRate', () => {
  const rows = new Map([
    ['OP10', { passRate: 98 }],
    ['OP20', { passRate: 99 }],
  ]);

  it('multiplies every selected station pass rate', () => {
    expect(combinedStationPassRate(rows, ['OP10', 'OP20'])).toBeCloseTo(97.02);
  });

  it('returns no result without a selection or when a selected station is absent', () => {
    expect(combinedStationPassRate(rows, [])).toBeNull();
    expect(combinedStationPassRate(rows, ['OP10', 'OP30'])).toBeNull();
  });
});
