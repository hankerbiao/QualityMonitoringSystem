import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Camera,
  ClipboardList,
  Database,
  Boxes,
  Cable,
  ClipboardCheck,
  Factory,
  Gauge,
  RotateCcw,
  Wrench,
} from 'lucide-react';

export type HomeModuleStatus = 'available' | 'planned';
export type HomeModuleAccent = 'blue' | 'amber' | 'emerald' | 'cyan' | 'rose' | 'slate';

export interface HomeModuleDefinition {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: HomeModuleAccent;
  path?: string;
  action?: 'open-settings';
  status: HomeModuleStatus;
}

export const qualityModules: readonly HomeModuleDefinition[] = [
  {
    id: 'rty',
    code: 'RTY',
    title: 'RTY（整机综合直通率）',
    description: '监控整机与过站直通率，支持基地、客户和订单多维下钻及指标预警。',
    icon: Activity,
    accent: 'blue',
    path: '/rty',
    status: 'available',
  },
  {
    id: 'lrr',
    code: 'LRR',
    title: 'LRR（工厂阶段部件故障率）',
    description: '按机型、部件类型和 PN 分析工厂阶段故障率，快速定位缺陷根因。',
    icon: AlertTriangle,
    accent: 'amber',
    path: '/lrr',
    status: 'planned',
  },
  {
    id: 'doa-repair',
    code: 'DOA',
    title: 'DOA 报修率',
    description: '按出货数统计开箱报修率，支持客户、机型与周期多维下钻。',
    icon: Wrench,
    accent: 'emerald',
    path: '/doa',
    status: 'available',
  },
  {
    id: 'doa-replacement',
    code: 'DOA/C',
    title: 'DOA 换件率',
    description: '在报修数中按服务单号匹配换上换下，统计开箱换件率。',
    icon: RotateCcw,
    accent: 'cyan',
    path: '/doa/replacement',
    status: 'available',
  },
  {
    id: 'mfr',
    code: 'MFR',
    title: 'MFR（现网月化故障率）',
    description: '结合换件记录与在保设备规模，观察产品现网月化故障表现。',
    icon: BarChart3,
    accent: 'rose',
    path: '/mfr',
    status: 'available',
  },
];

export const metadataModules: readonly HomeModuleDefinition[] = [
  {
    id: 'sales-orders',
    code: 'SALES',
    title: '销售订单看板',
    description: '展示全量销售订单，支持按机型、基地、排产日期与订单号多维筛选。',
    icon: ClipboardList,
    accent: 'cyan',
    path: '/sales-orders',
    status: 'available',
  },
  {
    id: 'doa-scs',
    code: 'DOA/SCS',
    title: 'SCS 数据明细',
    description: '查询 is_5000=true 的 DOA 原始数据与销售订单关联信息。',
    icon: Database,
    accent: 'emerald',
    path: '/doa/raw',
    status: 'available',
  },
  {
    id: 'order-bom-postings-sap',
    code: 'BOM',
    title: '订单 BOM 发料',
    description: '查看生产订单、物料、发料数量与过账日期等 SAP 发料明细。',
    icon: Boxes,
    accent: 'amber',
    path: '/metadata/order_bom_postings_sap',
    status: 'available',
  },
  {
    id: 'serial-bindings-sap',
    code: 'SERIAL',
    title: '序列号绑定',
    description: '查看整机序列号、部件序列号与生产订单的 SAP 绑定关系。',
    icon: Cable,
    accent: 'blue',
    path: '/metadata/serial_bindings_sap',
    status: 'available',
  },
  {
    id: 'repair-records-sap',
    code: 'REPAIR',
    title: '维修记录',
    description: '查看维修产品、故障现象、维修现象与处理来源等 SAP 原始记录。',
    icon: ClipboardCheck,
    accent: 'rose',
    path: '/metadata/repair_records_sap',
    status: 'available',
  },
  {
    id: 'station-records-sap',
    code: 'STATION',
    title: '工位过站记录',
    description: '查看生产工位、过站状态、操作类型与实际开始结束时间。',
    icon: Factory,
    accent: 'emerald',
    path: '/metadata/station_records_sap',
    status: 'available',
  },
];

export const toolModules: readonly HomeModuleDefinition[] = [
  {
    id: 'process-records',
    code: 'TRACE',
    title: '关键工位影像追溯',
    description: '按 SN 联查工序、工位、提交时间和现场影像，快速还原装配过程。',
    icon: Camera,
    accent: 'cyan',
    path: '/process-records',
    status: 'available',
  },
];

export const managementModules: readonly HomeModuleDefinition[] = [
  {
    id: 'operations',
    code: 'OPS',
    title: '运营监控',
    description: '查看活跃用户、访问趋势、功能使用排行和接口运行状态。',
    icon: Gauge,
    accent: 'blue',
    path: '/operations',
    status: 'available',
  },
];
