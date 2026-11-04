import type { FADOAChange, FAPreviewRequest, FARepairFault } from '../types/faApplications';

const repairFields: Array<[string, keyof FARepairFault]> = [
  ['基地', 'base'], ['生产订单', 'productionOrder'], ['机型', 'model'],
  ['设备 SN', 'sn'], ['工站', 'station'], ['NG 时间', 'ngTime'],
  ['不良维度3', 'faultDimension3'], ['不良维度2', 'faultDimension2'],
  ['维修维度3', 'repairDimension3'], ['物料号', 'materialNumber'],
  ['非关键物料号', 'nonCriticalMaterialNumber'], ['物料描述', 'materialDescription'],
  ['序列号', 'serialNumber'], ['替换前原厂码', 'originalFactoryCode'],
];
const doaFields: Array<[string, keyof FADOAChange]> = [
  ['PN', 'pn'], ['SN', 'sn'], ['备件名称', 'spareName'],
  ['原厂原码', 'originalCode'], ['报修设备', 'reportedDevice'], ['操作时间', 'operationTime'],
];

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] || character);

function fieldGrid(fields: Array<[string, string | undefined]>) {
  const cells = fields.map(([label, value]) => {
    const safeValue = escapeHtml(value || '—').replace(/\r\n|\r|\n/g, '<br>');
    return `<td width="50%" valign="top" style="width:50%;padding:5px 8px;font-size:13px;line-height:1.6;word-break:break-word;"><span style="color:#64748b;">${escapeHtml(label)}：</span><span style="color:#1e293b;">${safeValue}</span></td>`;
  });
  const rows = [];
  for (let index = 0; index < cells.length; index += 2) {
    rows.push(`<tr>${cells[index]}${cells[index + 1] || '<td></td>'}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">${rows.join('')}</table>`;
}

function faultSection<T>(title: string, rows: T[], fields: Array<[string, keyof T]>) {
  if (!rows.length) return '';
  const items = rows.map((row, index) => {
    const values: Array<[string, string | undefined]> = fields.map(([label, key]) => [label, String(row[key] ?? '')]);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid #e2e8f0;background-color:#ffffff;"><tr><td style="padding:8px 12px;background-color:#f1f5f9;color:#334155;font-size:13px;font-weight:600;">${escapeHtml(title)} ${index + 1}</td></tr><tr><td style="padding:6px;">${fieldGrid(values)}</td></tr></table>`;
  }).join('');
  return `<h2 style="margin:22px 0 10px;font-size:15px;color:#0f172a;">${escapeHtml(title)}（${rows.length} 条）</h2>${items}`;
}

export function emailPreviewHtml(
  subject: string,
  content: string,
  application: FAPreviewRequest,
  materialDescription: string,
  repairFaults: FARepairFault[],
  doaChanges: FADOAChange[],
) {
  const safeSubject = escapeHtml(subject.trim() || 'FA 质量反馈通知');
  const safeContent = escapeHtml(content).replace(/\r\n|\r|\n/g, '<br>') || '<span style="color:#94a3b8;">（未填写正文）</span>';
  const applicationFields: Array<[string, string | undefined]> = [
    ['物料号 PN', application.pn], ['厂商', application.vendor],
    ['物料描述', materialDescription], ['故障现象', application.faultDescription],
    ['发生环节', application.stages.join('、')],
  ];
  if (application.stages.includes('产测')) applicationFields.push(['产测计划开始时间', `${application.repairDateFrom} 至 ${application.repairDateTo}`]);
  if (application.stages.includes('DOA')) applicationFields.push(['DOA 操作时间', `${application.doaDateFrom} 至 ${application.doaDateTo}`]);
  const details = `<h2 style="margin:22px 0 10px;font-size:15px;color:#0f172a;">申请信息</h2>${fieldGrid(applicationFields)}${faultSection('产测故障', repairFaults, repairFields)}${faultSection('DOA 换下明细', doaChanges, doaFields)}`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;background-color:#eef3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#1e293b;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef3f8;padding:20px 10px;"><tr><td align="center"><table role="presentation" width="800" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:800px;background:#fff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden;"><tr><td style="height:5px;background:#2563eb;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:22px 28px 18px;border-bottom:1px solid #e8eef5;"><p style="margin:0 0 7px;color:#2563eb;font-size:11px;font-weight:700;letter-spacing:1px;">QUALIBOARD · FA</p><h1 style="margin:0;font-size:21px;line-height:1.45;color:#0f172a;font-weight:700;">${safeSubject}</h1></td></tr><tr><td style="padding:24px 28px 26px;"><p style="margin:0 0 12px;color:#475569;font-size:13px;font-weight:600;">邮件正文</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #3b82f6;border-radius:6px;"><tr><td style="padding:18px 20px;color:#334155;font-size:14px;line-height:1.85;word-break:break-word;">${safeContent}</td></tr></table>${details}</td></tr><tr><td style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;line-height:1.6;">本邮件由 QualiBoard FA 看板发送，请勿直接回复系统邮箱。</td></tr></table></td></tr></table></body></html>`;
}
