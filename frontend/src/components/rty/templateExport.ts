import * as XLSX from 'xlsx';
import type { RepairModelSheet, RTYTemplateExport, StationPassExport } from '../../types/rty';

type Column = readonly [key: string, label: string];

export const SUMMARY_COLUMNS: readonly Column[] = [
  ['model', '机型'],
  ['plannedQuantity', '计划数量'],
  ['completedQuantity', '完工数量'],
  ['defectCount', '非直通数'],
  ['inputRate', '投入直通率'],
  ['completionRate', '订单数量直通率'],
  ['initialDefects', '初检非直通数'],
  ['initialRate', '初检直通率'],
  ['pretestDefects', '初检前测非直通数'],
  ['pretestRate', '初检前测直通率'],
  ['agingDefects', '老化非直通数'],
  ['agingRate', '老化直通率'],
  ['posttestDefects', '综检后测非直通数'],
  ['posttestRate', '综检后测直通率'],
  ['finalInspectionDefects', '综检非直通数'],
  ['finalInspectionRate', '综检直通率'],
  ['voltageDefects', '耐压非直通数'],
  ['voltageRate', '耐压直通率'],
  ['finalRate', '最终直通率'],
];

export const ORDER_COLUMNS: readonly Column[] = [
  ['VBELN', '销售订单'],
  ['POSNR', '行项目'],
  ['AUFNR', '生产订单'],
  ['MAKTX_TH', '生产机型'],
  ['CPXH', '产品型号'],
  ['IF_L6', 'L6标识'],
  ['ZSTAT', 'MES状态回传'],
  ['KID', '客户ID'],
  ['GAMNG', '订单数量'],
  ['packagingQuantity', '包装数量'],
  ['GSTRS', '计划开始时间'],
  ['ZDATE_STARTED', '订单实际开始时间'],
  ['AUART', '订单类型'],
  ['WERKS', '下单工厂'],
  ['LGORT', '库存地点'],
  ['MATNR', '物料编号'],
  ['MAKTX', '物料描述'],
  ['NAME1_ZU', '最终用户'],
];

export const FAULT_COLUMNS: readonly Column[] = [
  ['FACTORY', '生产基地'],
  ['VBELN', '销售订单'],
  ['AUFNR', '生产订单'],
  ['ZJXMC', '机型'],
  ['PCODE', '主机条码'],
  ['ZNGGZ', 'NG工站'],
  ['U_FIND', 'NG报工人员'],
  ['T_FIND', 'NG时间'],
  ['ZNGWD3', '不良现象维度3'],
  ['ZNGWD2', '不良现象维度2'],
  ['U_FIX', '维修人员'],
  ['ZWXDT', '维修日期时间'],
  ['ZWXWD3', '维修维度3'],
  ['SECFLG', '二次物料标识'],
  ['ZBJ', '涉及部件'],
  ['ZZRFL', '缺陷责任分类'],
  ['ZCCLH', '重插部件料号'],
  ['SECOND_PART_NO', '重插物料序号'],
  ['FIX_REMARKS', '维修人员备注维修信息'],
  ['MATNR', '物料号'],
  ['MAKTX', '物料描述（短文本）'],
  ['ZMCOD1', '序列号'],
  ['ZRCOD1', '替换前原厂码'],
  ['ZMCOD2', '替换后曙光码'],
  ['ZRCOD2', '替换后原厂码'],
  ['RECORD01REPAIRM', '非关键件物料序号'],
  ['ERROR_CODE', '错误码'],
  ['ERROR_MSG', '错误码描述'],
  ['REJUDGE', '复判人员'],
  ['RET', '复判结论'],
  ['RPDESC', '复判问题描述'],
  ['RNOTE', '复判备注'],
  ['U_RMA_NAM', 'RMA复判人员'],
  ['RMA_RESULT', 'RMA复判结论'],
  ['AUART', '订单类型'],
];

export const TOP_COLUMNS: readonly Column[] = [
  ['sequence', '序号'],
  ['model', '机型'],
  ['problem', '不良现象维度3'],
  ['repairAction', '维修维度3'],
  ['material', '物料号'],
  ['materialDescription', '物料描述（短文本）'],
  ['materialCount', '物料计数'],
  ['materialUsage', '物料使用量'],
  ['componentFaultRate', '部件故障率'],
  ['serialCount', '整机故障数'],
  ['productionQuantity', '整机生产量'],
  ['machineFaultRate', '整机故障率'],
];

export const REPAIR_COLUMNS: readonly Column[] = TOP_COLUMNS.map(([key, label]) => [
  key, key === 'materialCount' ? '部件故障计数' : label,
]);

function buildSourceSheet(
  columns: readonly Column[],
  rows: readonly Record<string, unknown>[],
): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet([
    columns.map(([, label]) => label),
    ...rows.map((row) => columns.map(([key]) => row[key] ?? null)),
  ]);
  sheet['!cols'] = columns.map(([, label]) => ({
    wch: Math.min(48, Math.max(16, label.length * 1.4)),
  }));
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  return sheet;
}

export function buildFaultDetailSheet(rows: readonly Record<string, unknown>[]): XLSX.WorkSheet {
  return buildSourceSheet(FAULT_COLUMNS, rows);
}

function modelSheetName(workbook: XLSX.WorkBook, model: string): string {
  const base = (model.replace(/[\\/*?:[\]]/g, '_').replace(/^'+|'+$/g, '') || '未填写机型').slice(0, 31);
  const used = new Set(workbook.SheetNames.map(name => name.toLowerCase()));
  let name = base;
  for (let suffix = 2; used.has(name.toLowerCase()); suffix += 1) {
    const ending = `_${suffix}`;
    name = `${base.slice(0, 31 - ending.length)}${ending}`;
  }
  return name;
}

export function appendModelSheets(workbook: XLSX.WorkBook, models: RepairModelSheet[] = []): void {
  for (const { model, rows: sourceRows } of models) {
    const rows: RepairModelSheet['rows'] = [...sourceRows]
      .sort((a, b) => Number(b.materialCount ?? 0) - Number(a.materialCount ?? 0))
      .map((row, index) => ({
        ...row,
        sequence: row.repairAction === '无维修故障记录' ? null : index + 1,
      }));
    const sheet = XLSX.utils.aoa_to_sheet([
      REPAIR_COLUMNS.map(([, label]) => label),
      ...rows.map(row => REPAIR_COLUMNS.map(([key]) => row[key] ?? null)),
    ]);
    sheet['!cols'] = [7, 17, 65, 22, 30, 46, 18, 20, 16, 22, 20, 16].map(wch => ({ wch }));
    sheet['!autofilter'] = { ref: sheet['!ref']! };
    rows.forEach((row, index) => {
      for (const [column, count, denominator] of [
        ['I', row.materialCount, row.materialUsage],
        ['L', row.serialCount, row.productionQuantity],
      ] as const) {
        if (column === 'I' && row.repairAction === '无维修故障记录') continue;
        const address = `${column}${index + 2}`;
        if (typeof count === 'number' && typeof denominator === 'number' && denominator > 0) {
          sheet[address] = {
            t: 'n',
            v: count / denominator,
            f: `${column === 'I' ? 'G' : 'J'}${index + 2}/${column === 'I' ? 'H' : 'K'}${index + 2}`,
            z: '0.00%',
          };
        } else {
          sheet[address] = { t: 's', v: 'n.a.' };
        }
      }
    });
    XLSX.utils.book_append_sheet(workbook, sheet, modelSheetName(workbook, model));
  }
}

export function appendSourceSheets(workbook: XLSX.WorkBook, data: StationPassExport): void {
  XLSX.utils.book_append_sheet(workbook, buildSourceSheet(ORDER_COLUMNS, data.orders), '销售订单');
  XLSX.utils.book_append_sheet(workbook, buildFaultDetailSheet(data.faults), '维修故障明细记录');
  appendModelSheets(workbook, data.modelSheets);
}

export function buildTemplateWorkbook(data: RTYTemplateExport): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  if (data.modelSheets !== undefined) {
    const summary = XLSX.utils.aoa_to_sheet([
      SUMMARY_COLUMNS.map(([, label]) => label),
      ...data.summary.map(row => SUMMARY_COLUMNS.map(([key]) => row[key] ?? null)),
    ]);
    SUMMARY_COLUMNS.forEach(([key], column) => {
      if (!key.endsWith('Rate')) return;
      data.summary.forEach((_, row) => {
        const cell = summary[XLSX.utils.encode_cell({ r: row + 1, c: column })];
        if (cell?.t === 'n') cell.z = '0.00%';
      });
    });
    XLSX.utils.book_append_sheet(workbook, summary, '直通率');
    appendSourceSheets(workbook, data);
    return workbook;
  }
  const sheets = [
    ['直通率', SUMMARY_COLUMNS, data.summary, false],
    ['销售订单-分母', ORDER_COLUMNS, data.orders, true],
    ['维修故障明细记录-分子', FAULT_COLUMNS, data.faults, true],
    ['TOP问题', TOP_COLUMNS, data.topProblems, false],
  ] as const;
  for (const [name, columns, rows, hasNote] of sheets) {
    const values = [
      ...(hasNote ? [['数据字段按如下顺序显示']] : []),
      columns.map(([, label]) => label),
      ...rows.map(row => columns.map(([key]) => row[key] ?? null)),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(values);
    sheet['!cols'] = columns.map(([, label]) => ({
      wch: Math.min(48, Math.max(16, label.length * 1.4)),
    }));
    const headerRow = hasNote ? 1 : 0;
    sheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: headerRow, c: 0 },
        e: { r: Math.max(headerRow, values.length - 1), c: columns.length - 1 },
      }),
    };
    columns.forEach(([key], column) => {
      if (!key.endsWith('Rate')) return;
      rows.forEach((_, row) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: headerRow + 1 + row, c: column })];
        if (cell?.t === 'n') cell.z = '0.00%';
      });
    });
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return workbook;
}
