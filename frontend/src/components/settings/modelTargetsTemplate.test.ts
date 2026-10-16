import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildModelTargetsTemplate, parseModelTargetsTemplate, TARGET_TEMPLATE_HEADERS } from './modelTargetsTemplate';

function workbook(rows: unknown[][]): XLSX.WorkBook {
  const result = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(result, XLSX.utils.aoa_to_sheet([TARGET_TEMPLATE_HEADERS, ...rows]), '直通率标准');
  return result;
}

describe('model target Excel templates', () => {
  it('includes all unique source models and configured-only models, preserving zero and defaulting to 100', () => {
    const result = buildModelTargetsTemplate(['L6', ' M2 ', 'M2', ''], { M1: 98.5, L6: 0 });
    const roundtrip = XLSX.read(XLSX.write(result, { type: 'buffer', bookType: 'xlsx' }), { cellNF: true });
    expect(parseModelTargetsTemplate(roundtrip)).toEqual({ L6: 0, M1: 98.5, M2: 100 });
    expect(() => buildModelTargetsTemplate([], {})).toThrow('暂无机型');
  });

  it('accepts plain numbers, percentage text and Excel percent cells, and defaults blank cells to 100', () => {
    const result = workbook([[' A ', 98.5], ['B', '99.25%'], ['C', null], ['D', 0], [null, null], ['E', 0.985], ['F', 0.5]]);
    result.Sheets['直通率标准'].B7.z = '0.0%';
    const roundtrip = XLSX.read(XLSX.write(result, { type: 'buffer', bookType: 'xlsx' }), { cellNF: true });
    expect(parseModelTargetsTemplate(roundtrip)).toEqual({ A: 98.5, B: 99.25, C: 100, D: 0, E: 98.5, F: 0.5 });
  });

  it.each([
    [[['M', 101]], '第 2 行'],
    [[['M', -1]], '0–100'],
    [[['M', '98abc']], '数字或百分比'],
    [[['M', true]], '必须为数字'],
    [[[null, 99]], '机型名称不能为空'],
    [[['M', 99], [' M ', 100]], '第 3 行'],
  ] as [unknown[][], string][])('rejects invalid data without returning partial results', (rows, message) => {
    expect(() => parseModelTargetsTemplate(workbook(rows))).toThrow(message);
  });

  it('rejects formulas even with numeric cached values', () => {
    const result = workbook([['M', 99]]);
    result.Sheets['直通率标准'].B2.f = '100-1';
    expect(() => parseModelTargetsTemplate(result)).toThrow('不能使用公式');
  });

  it('rejects missing headers, duplicate headers, ambiguous sheets and empty data', () => {
    expect(() => parseModelTargetsTemplate(workbook([]))).toThrow('没有有效');
    const result = workbook([['M', 99]]);
    result.Sheets['直通率标准'].B1.v = 'Wrong';
    expect(() => parseModelTargetsTemplate(result)).toThrow('表头');
    const repeated = workbook([['M', 99]]);
    XLSX.utils.book_append_sheet(repeated, repeated.Sheets['直通率标准'], '重复');
    expect(() => parseModelTargetsTemplate(repeated)).toThrow('一张');
    const duplicate = workbook([['M', 99]]);
    XLSX.utils.sheet_add_aoa(duplicate.Sheets['直通率标准'], [['机型名称']], { origin: 'C1' });
    expect(() => parseModelTargetsTemplate(duplicate)).toThrow('重复');
  });
});
