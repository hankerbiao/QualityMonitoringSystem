import { describe, expect, it } from 'vitest';
import { FAULT_COLUMNS } from './templateExport';
import { REPAIR_DETAIL_COLUMNS } from './repairDetailColumns';

describe('repair detail columns', () => {
  it('uses the complete fault export fields in their defined order', () => {
    expect(REPAIR_DETAIL_COLUMNS).toEqual(FAULT_COLUMNS);
    expect(REPAIR_DETAIL_COLUMNS).toHaveLength(35);
    expect(REPAIR_DETAIL_COLUMNS.map(([, label]) => label)).toEqual([
      '生产基地', '销售订单', '生产订单', '机型', '主机条码', 'NG工站', 'NG报工人员',
      'NG时间', '不良现象维度3', '不良现象维度2', '维修人员', '维修日期时间', '维修维度3',
      '二次物料标识', '涉及部件', '缺陷责任分类', '重插部件料号', '重插物料序号',
      '维修人员备注维修信息', '物料号', '物料描述（短文本）', '序列号', '替换前原厂码',
      '替换后曙光码', '替换后原厂码', '非关键件物料序号', '错误码', '错误码描述',
      '复判人员', '复判结论', '复判问题描述', '复判备注', 'RMA复判人员', 'RMA复判结论', '订单类型',
    ]);
  });
});
