import * as XLSX from 'xlsx';

export const TARGET_TEMPLATE_SHEET = '直通率标准';
export const TARGET_TEMPLATE_HEADERS = ['机型名称', '直通率标准 (%)'];
const MAX_TEMPLATE_ROWS = 20_000;

export function buildModelTargetsTemplate(models: string[], targets: Record<string, number>): XLSX.WorkBook {
  const names = [...new Set([...models.map(model => model.trim()).filter(Boolean), ...Object.keys(targets)])]
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  if (!names.length) throw new Error('数据源暂无机型，无法生成模板');
  if (names.length > MAX_TEMPLATE_ROWS) throw new Error(`模板最多支持 ${MAX_TEMPLATE_ROWS} 个机型`);
  const sheet = XLSX.utils.aoa_to_sheet([
    TARGET_TEMPLATE_HEADERS,
    ...names.map(model => [model, targets[model] ?? 100]),
  ]);
  sheet['!cols'] = [{ wch: 35 }, { wch: 24 }];
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, TARGET_TEMPLATE_SHEET);
  return workbook;
}

function header(value: unknown): string {
  return String(value ?? '').replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/％/g, '%');
}

function modelColumn(sheet: XLSX.WorkSheet): [number, number] | null {
  if (!sheet['!ref']) return null;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.c > 100) return null;
  let model = -1;
  let rate = -1;
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const label = header(sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })]?.v);
    if (label === '机型名称' || label === '机型') {
      if (model !== -1) throw new Error('模板包含重复的机型表头');
      model = column;
    }
    if (label === '直通率标准(%)' || label === '直通率标准') {
      if (rate !== -1) throw new Error('模板包含重复的直通率标准表头');
      rate = column;
    }
  }
  return model >= 0 && rate >= 0 ? [model, rate] : null;
}

function parseRate(cell: XLSX.CellObject | undefined): number {
  if (cell?.f) throw new Error('直通率标准不能使用公式');
  if (cell === undefined || cell.v === null || cell.v === undefined || String(cell.v).trim() === '') return 100;
  let rate: number;
  if (cell.t === 'n' && typeof cell.v === 'number') {
    // Excel stores 98.5% as 0.985; plain numeric cells already use 0–100.
    const format = typeof cell.z === 'number' ? XLSX.SSF.get_table()[cell.z] ?? '' : cell.z ?? '';
    const hasPercentFormat = format.replace(/"[^"]*"|\\./g, '').includes('%');
    rate = cell.v * (hasPercentFormat ? 100 : 1);
  } else if (cell.t === 's') {
    const value = String(cell.v).trim().replace(/％$/, '%');
    if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value)) throw new Error('直通率标准必须为 0–100 的数字或百分比');
    rate = Number(value.replace(/%$/, ''));
  } else {
    throw new Error('直通率标准必须为数字');
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('直通率标准必须在 0–100 之间');
  return Number(rate.toFixed(10));
}

export function parseModelTargetsTemplate(workbook: XLSX.WorkBook): Record<string, number> {
  const candidates = workbook.SheetNames.flatMap(name => {
    const columns = modelColumn(workbook.Sheets[name]);
    return columns ? [{ sheet: workbook.Sheets[name], columns }] : [];
  });
  if (candidates.length !== 1) throw new Error('请提供一张包含“机型名称”和“直通率标准 (%)”表头的工作表');
  const { sheet, columns: [modelIndex, rateIndex] } = candidates[0];
  const range = XLSX.utils.decode_range(sheet['!ref']!);
  if (range.e.r - range.s.r > MAX_TEMPLATE_ROWS) throw new Error(`模板最多支持 ${MAX_TEMPLATE_ROWS} 行机型`);
  const entries = new Map<string, number>();
  const errors: string[] = [];
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const modelCell = sheet[XLSX.utils.encode_cell({ r: row, c: modelIndex })];
    const rateCell = sheet[XLSX.utils.encode_cell({ r: row, c: rateIndex })];
    const model = String(modelCell?.v ?? '').trim();
    if (!model && !modelCell?.f && !rateCell?.f && String(rateCell?.v ?? '').trim() === '') continue;
    try {
      if (!model) throw new Error('机型名称不能为空');
      if (modelCell?.f || !['s', 'str', 'n'].includes(modelCell?.t ?? '')) throw new Error('机型名称必须为文本或数字，不能使用公式');
      if (entries.has(model)) throw new Error(`机型“${model}”重复`);
      entries.set(model, parseRate(rateCell));
    } catch (error) {
      errors.push(`第 ${row + 1} 行：${(error as Error).message}`);
    }
  }
  if (errors.length) throw new Error(`${errors.slice(0, 20).join('\n')}${errors.length > 20 ? `\n另有 ${errors.length - 20} 行错误` : ''}`);
  if (!entries.size) throw new Error('模板中没有有效的机型数据');
  return Object.fromEntries(entries);
}
