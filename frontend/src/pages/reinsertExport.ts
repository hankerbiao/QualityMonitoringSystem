import * as XLSX from 'xlsx';
import type { ReinsertCell, ReinsertDashboard, ReinsertQuery } from '../api/reinsertApi';

const metrics = (cell: ReinsertCell) => ({
  重插数: cell.reinsertCount,
  维修数: cell.repairCount,
  计划量: cell.plannedQuantity,
  整机重插率: cell.plannedRate,
});

export function buildReinsertWorkbook(data: ReinsertDashboard, query: ReinsertQuery): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  const info = XLSX.utils.aoa_to_sheet([
    ['订单计划开始日期', query.dateFrom], ['订单计划结束日期', query.dateTo],
    ['机型筛选', query.productModels?.join('、') || '全部'],
    ['基地筛选', query.bases?.join('、') || '全部'],
    ['客户筛选', query.customers?.join('、') || '全部'],
    ['缺少 SN 或工站的记录', data.invalidCount], ['其中重插记录', data.invalidReinsertCount],
    ['说明', '重插率以百分数数值表示，例如 2 表示 2%。空值表示数据缺失或无法计算。'],
  ]);
  info['!cols'] = [{ wch: 26 }, { wch: 85 }];
  XLSX.utils.book_append_sheet(book, info, '查询条件');

  const summary: Record<string, string | number | null>[] = [];
  const details: Record<string, string | number | null>[] = [];
  const daily: Record<string, string | number | null>[] = [];
  for (const { model, bases } of data.models) {
    for (const base of bases) {
      const scope = { 机型: model || '未填写机型', 基地: base.base };
      for (const month of data.months) {
        summary.push({ ...scope, 月份: month, ...metrics(base.months[month]) });
        for (const component of base.components) {
          details.push({ ...scope, 月份: month, 类型: '部件', 部件: component.component, PN: '', ...metrics(component.months[month]), PN净发料: null, PN使用重插率: null, 说明: '' });
          for (const pn of component.pns) {
            const value = pn.months[month];
            details.push({ ...scope, 月份: month, 类型: 'PN', 部件: component.component, PN: pn.pn, ...metrics(value), PN净发料: value.usageQuantity, PN使用重插率: value.usageRate, 说明: value.usageReason });
          }
        }
      }
      for (const [date, value] of Object.entries(base.days ?? {})) {
        daily.push({ ...scope, 日期: date, 类型: '基地', PN: '', ...metrics(value) });
        for (const pn of base.topPns) {
          const pnValue = pn.days?.[date];
          if (pnValue) daily.push({ ...scope, 日期: date, 类型: 'PN Top 5', PN: pn.pn, ...metrics(pnValue) });
        }
      }
    }
  }
  const appendRows = (name: string, rows: Record<string, string | number | null>[], headers: string[]) => {
    const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    sheet['!cols'] = headers.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(book, sheet, name);
  };
  appendRows('机型基地汇总', summary, ['机型', '基地', '月份', '重插数', '维修数', '计划量', '整机重插率']);
  appendRows('部件PN汇总', details, ['机型', '基地', '月份', '类型', '部件', 'PN', '重插数', '维修数', '计划量', '整机重插率', 'PN净发料', 'PN使用重插率', '说明']);
  if (daily.length) appendRows('每日趋势', daily, ['机型', '基地', '日期', '类型', 'PN', '重插数', '维修数', '计划量', '整机重插率']);
  return book;
}
