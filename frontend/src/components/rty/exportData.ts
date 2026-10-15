import { rtyApi } from '../../api/rtyApi';
import type { RTYData } from '../../types';

export async function loadFaultExportRows(rows: RTYData[]) {
  const sns = [...new Set(rows.flatMap(row => row.faultSerialNumbers ?? row.serialNumbers))];
  const details = [];
  for (let index = 0; index < sns.length; index += 200) {
    details.push(...await rtyApi.getDefectDetails(sns.slice(index, index + 200)));
  }
  return details.map(item => ({
    机器SN: item.sn,
    销售订单: item.sale_no,
    生产订单: item.mfg_order,
    客户: item.customer,
    产品机型: item.product_family,
    故障类型: item.defectCode,
    故障描述: item.description,
    二次故障现象: item.fault_2nd_appear,
    三次故障现象: item.fault_3rd_appear,
    维修人: item.repairPerson,
    维修时间: item.repairTime,
    维修有效性: item.repair_effectiveness,
  }));
}
