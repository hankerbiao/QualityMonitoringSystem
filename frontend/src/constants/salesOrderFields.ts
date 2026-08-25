/**
 * SAP 销售订单 data 字段中文翻译。
 * 详情弹窗中展示 data 字段时，优先显示中文名，并附原始 key 对照。
 */
export const SAP_FIELD_LABELS: Record<string, string> = {
  VBELN: '销售订单',
  POSNR: '行项目',
  ETENR: '分批行',
  MATNR: '物料编号',
  MAKTX: '物料描述',
  CPXH: '产品型号',
  ZSTAT: 'MES状态回传',
  WERKS: '下单工厂',
  IF_L6: 'L6标识',
  KID: '客户ID',
  GAMNG: '订单数量（SAP 原始值）',
  AUART: '订单类型',
  LGORT: '库存地点',
  NAME1_ZU: '最终用户',
  MAKTX_TH: '生产机型',
  WMENG: '入库数量',
  GSTRS: '计划开始时间',
  ZDATE_STARTED: '订单实际开始时间',
};

/**
 * SAP 字段值格式化。
 * IF_L6 特殊处理：X → L6，空 / 其他 → 非L6；其余字段原样返回。
 */
export function formatSapFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'IF_L6') {
    return String(value).trim() === 'X' ? 'L6' : '非L6';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
