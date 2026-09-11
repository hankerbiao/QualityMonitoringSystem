import { describe, expect, it } from 'vitest';
import { displayMaterialNumber } from './lrr';

describe('displayMaterialNumber', () => {
  it('displays only the trailing eight characters of a long PN', () => {
    expect(displayMaterialNumber('0000000012345678')).toBe('12345678');
  });

  it('keeps short material numbers unchanged', () => {
    expect(displayMaterialNumber('PN-123')).toBe('PN-123');
  });
});
