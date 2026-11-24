export const REPAIR_SOURCE_COLUMNS = [
  ['FACTORY', '生产基地'],
  ['ZNGWD2', '不良现象维度2'],
  ['MATNR', '物料号'],
  ['MAKTX', '物料描述'],
  ['ERROR_CODE', '错误码'],
  ['FIX_REMARKS', '维修备注'],
] as const;

export const REPAIR_DETAIL_COLUMNS = [
  ['matchedModel', '计入机型'],
  ['PCODE', '维修记录SN'],
  ['VBELN', '销售订单'],
  ['AUFNR', '维修记录订单'],
  ['ZNGWD3', '故障现象'],
  ['ZWXWD3', '维修措施'],
  ['ZNGGZ', '故障工站'],
  ['U_FIX', '维修人员'],
  ['ZWXDT', '维修时间'],
  ...REPAIR_SOURCE_COLUMNS,
] as const;
