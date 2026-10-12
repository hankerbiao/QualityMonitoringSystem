import { describe, expect, it } from 'vitest';
import { displayMaterialNumber, matchingPlannedRange, recentPlannedRange } from './lrr';

describe('displayMaterialNumber', () => {
  it('displays only the trailing eight characters of a long PN', () => {
    expect(displayMaterialNumber('0000000012345678')).toBe('12345678');
  });

  it('keeps short material numbers unchanged', () => {
    expect(displayMaterialNumber('PN-123')).toBe('PN-123');
  });
});

describe('recentPlannedRange', () => {
  const today = new Date(2026, 8, 23);

  it('starts at the first day of the window and ends today', () => {
    expect(recentPlannedRange(1, today)).toEqual({ plannedDateFrom: '2026-09-01', plannedDateTo: '2026-09-23' });
    expect(recentPlannedRange(3, today)).toEqual({ plannedDateFrom: '2026-07-01', plannedDateTo: '2026-09-23' });
    expect(recentPlannedRange(12, today)).toEqual({ plannedDateFrom: '2025-10-01', plannedDateTo: '2026-09-23' });
    expect(matchingPlannedRange('2026-08-01', '2026-09-23', today)).toBe(2);
    expect(matchingPlannedRange('2025-10-01', '2026-09-23', today)).toBe(12);
    expect(matchingPlannedRange('2026-07-01', '2026-09-30', today)).toBeNull();
  });
});
