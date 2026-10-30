import * as XLSX from 'xlsx';
import type { DoaDashboard, DoaDimensionItem, DoaFilters, DoaOrderItem, DoaRepairItem } from '../../types/doa';

type Row = Record<string, string | number>;

function addSheet(workbook: XLSX.WorkBook, name: string, rows: Row[], headers: string[], percentHeaders: string[] = []) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  rows.forEach((_, row) => percentHeaders.forEach(header => {
    const column = headers.indexOf(header);
    const cell = sheet[XLSX.utils.encode_cell({ r: row + 1, c: column })];
    if (cell && cell.t === 'n') cell.z = '0.00%';
  }));
  sheet['!cols'] = headers.map(header => ({ wch: Math.max(16, header.length * 2 + 4) }));
  if (rows.length) sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

const percent = (value: number | null) => value == null ? '' : value / 100;
const metricHeaders = ['计划数量', '报修数量', '报修率', '换件数量', '换件率'];
const metrics = (item: DoaDimensionItem) => ({
  计划数量: item.shippedCount, 报修数量: item.repairCount, 报修率: percent(item.repairRate),
  换件数量: item.replacementCount, 换件率: percent(item.replacementRate),
});

function repairRows(items: DoaRepairItem[]): Row[] {
  return items.map(item => ({
    申报编号: item.id, 销售订单: item.salesOrder, 序列号: item.materialSerial,
    受理日期: item.acceptedAt, 生产订单计划日期: item.plannedAt,
    计划日期匹配状态: item.gstrsStatus, 客户: item.customer, 客户ID: item.customerId || '', 机型: item.model,
    问题批次数量: item.missingQuantity ? '' : item.repairCount,
  }));
}

const repairHeaders = ['申报编号', '销售订单', '序列号', '受理日期', '生产订单计划日期', '计划日期匹配状态', '客户', '客户ID', '机型', '问题批次数量'];

export function buildDoaWorkbook(
  dashboard: DoaDashboard,
  filters: DoaFilters,
  orders: DoaOrderItem[],
  details: { repairs: DoaRepairItem[]; replacements: DoaRepairItem[]; unmatchedDates: DoaRepairItem[] } | null,
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const { summary } = dashboard;
  const customers = filters.customers?.length ? filters.customers.join('、') : filters.customer || '全部';
  const customerIds = filters.customerIds?.length ? filters.customerIds.join('、') : filters.customerId || '全部';
  const models = filters.models?.length ? filters.models.join('、') : filters.model || '全部';
  const overview: Row[] = [
    { 项目: '计划开始日期', 内容: `${filters.dateFrom || '不限'} 至 ${filters.dateTo || '不限'}` },
    ...(filters.acceptedDateFrom || filters.acceptedDateTo ? [{ 项目: '附加计划日期范围', 内容: `${filters.acceptedDateFrom || '不限'} 至 ${filters.acceptedDateTo || '不限'}` }] : []),
    { 项目: '客户', 内容: customers }, { 项目: '客户ID', 内容: customerIds }, { 项目: '机型', 内容: models },
    { 项目: '统计周期', 内容: { day: '日', month: '月', year: '年' }[filters.timeGranularity] },
    { 项目: '计划数量', 内容: summary.shippedCount }, { 项目: '报修数量', 内容: summary.repairCount },
    { 项目: '报修率', 内容: percent(summary.repairRate) }, { 项目: '换件数量', 内容: summary.replacementCount },
    { 项目: '换件率', 内容: percent(summary.replacementRate) }, { 项目: '换件申报条数', 内容: summary.replacementRecordCount },
    { 项目: '已匹配销售订单申报条数', 内容: summary.matchedRepairRecords },
    { 项目: '未匹配销售订单申报条数', 内容: summary.unmatchedRepairRecords },
    { 项目: '未匹配计划日期申报条数', 内容: summary.unmatchedPlannedRecords },
    { 项目: '未匹配计划日期问题批次数量', 内容: summary.unmatchedPlannedQuantity },
    { 项目: '数据更新至', 内容: summary.latestDataAt || '' },
    { 项目: '计算口径', 内容: '报修率 = 有效报修问题批次数量 / 订单计划数量；计划数量不代表实际发货量。' },
    { 项目: '数据范围', 内容: '判定结果为是，排除待受理和问题批次数量为空的申报；按生产订单计划开始日期 GSTRS 筛选。' },
    { 项目: '未匹配计划日期', 内容: '不受日期筛选，不计入当前报修率；仍受客户和机型筛选。' },
    ...(details ? [] : [{ 项目: '报修明细', 内容: '当前账号没有报修明细权限，未导出报修记录。' }]),
  ];
  addSheet(workbook, '质量概览', overview, ['项目', '内容']);
  overview.forEach((row, index) => {
    if (row.项目 === '报修率' || row.项目 === '换件率') {
      const cell = workbook.Sheets['质量概览'][XLSX.utils.encode_cell({ r: index + 1, c: 1 })];
      if (cell && cell.t === 'n') cell.z = '0.00%';
    }
  });
  const rateHeaders = ['报修率', '换件率'];
  addSheet(workbook, '周期明细', dashboard.trend.map(item => ({ 周期: item.period, ...metrics(item), 报修序列号数: item.repairServerCount })), ['周期', ...metricHeaders, '报修序列号数'], rateHeaders);
  addSheet(workbook, '客户分析', dashboard.byCustomer.map(item => ({ 客户: item.key, ...metrics(item) })), ['客户', ...metricHeaders], rateHeaders);
  addSheet(workbook, '机型分析', dashboard.byModel.map(item => ({ 机型: item.key, ...metrics(item) })), ['机型', ...metricHeaders], rateHeaders);
  addSheet(workbook, '到货订单明细', orders.map(item => ({ 销售订单: item.salesOrder, 生产订单: item.productionOrder, 客户: item.customer, 客户ID: item.customerId || '', 机型: item.model, 计划开始日期: item.plannedStartDate, 计划数量: item.quantity })), ['销售订单', '生产订单', '客户', '客户ID', '机型', '计划开始日期', '计划数量']);
  addSheet(workbook, '未匹配销售订单', dashboard.unmatchedOrders.map(item => ({ 销售订单: item.salesOrder, 申报条数: item.recordCount })), ['销售订单', '申报条数']);
  if (details) {
    addSheet(workbook, '报修明细', repairRows(details.repairs), repairHeaders);
    addSheet(workbook, '换件明细', repairRows(details.replacements), repairHeaders);
    addSheet(workbook, '未匹配计划日期', repairRows(details.unmatchedDates), repairHeaders);
  }
  return workbook;
}
