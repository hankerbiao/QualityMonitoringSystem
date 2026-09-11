import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Camera,
  Database,
  Factory,
  Gauge,
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
    description: '监控整机综合直通率，支持基地、客户和订单多维下钻及指标预警。',
    icon: Activity,
    accent: 'blue',
    path: '/rty',
    status: 'available',
  },
  {
    id: 'station-pass-rate',
    code: 'STATION RTY',
    title: '工位过站直通率',
    description: '按工位统计过站数量与维修数量，查看各工位直通率和异常工位。',
    icon: Factory,
    accent: 'cyan',
    path: '/station-pass-rate',
    status: 'available',
  },
  {
    id: 'lrr',
    code: 'LRR',
    title: 'LRR（工厂阶段部件故障率）',
    description: '基于订单 BOM 发料与故障看板，按生产订单、销售订单和库存点分析部件故障率。',
    icon: AlertTriangle,
    accent: 'amber',
    path: '/lrr',
    status: 'available',
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
    id: 'doa-scs',
    code: 'SCS',
    title: 'SCS 服务单',
    description: '查看 SCS 服务单原始字段、销售订单关联和生命周期补采信息。',
    icon: Database,
    accent: 'emerald',
    path: '/metadata/scs_doa',
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
