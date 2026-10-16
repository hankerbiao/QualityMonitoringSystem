import type { HomeModuleStatus } from '../config/homeModules';

export interface ProcessRecordConfig {
  username: string;
  password: string;
  hasPassword: boolean;
}

export interface ProcessRecordConnectionResult {
  source: 'system1' | 'system2';
  name: string;
  online: boolean;
  message: string;
}

export interface ProcessRecordConnectionTest {
  success: boolean;
  sources: ProcessRecordConnectionResult[];
}

export interface ModelTargets {
  [model: string]: number;
}

export interface EmailAlertConfig {
  enabled: boolean;
  emails: string;
  triggerCondition: string;
  weeklyProductionThreshold: number;
}

export interface SettingsResponse {
  processRecords: ProcessRecordConfig;
  modelTargets: ModelTargets;
  emailAlert: EmailAlertConfig;
  dashboardStatuses: Record<string, HomeModuleStatus>;
  cycleStatsConfig: CycleStatsConfig;
  stationPassRateConfig: StationPassRateConfig;
}

export type AccessibleSettingsResponse =
  | SettingsResponse
  | Pick<SettingsResponse, 'modelTargets' | 'emailAlert' | 'stationPassRateConfig'>;

export interface SettingsContextType {
  settings: SettingsResponse;
  updateSettings: (config: SettingsUpdate) => Promise<void>;
  loading: boolean;
  error: string | null;
  reloadSettings: () => void;
}

export interface SettingsUpdate {
  processRecords?: Partial<ProcessRecordConfig>;
  modelTargets?: ModelTargets;
  emailAlert?: Partial<EmailAlertConfig>;
  dashboardStatuses?: Record<string, HomeModuleStatus>;
  cycleStatsConfig?: CycleStatsConfig;
  stationPassRateConfig?: StationPassRateConfigUpdate;
}

export interface CycleStatsConfig {
  selectedModels: string[];
}

export interface StationPassRateConfig {
  selectedStations: string[];
  configured: boolean;
}

export type StationPassRateConfigUpdate = Pick<StationPassRateConfig, 'selectedStations'>;
