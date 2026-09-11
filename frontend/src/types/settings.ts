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
  cycleStatsConfig: CycleStatsConfig;
}

export interface SettingsContextType {
  settings: SettingsResponse;
  updateSettings: (config: SettingsUpdate) => Promise<void>;
  loading: boolean;
}

export interface SettingsUpdate {
  processRecords?: Partial<ProcessRecordConfig>;
  modelTargets?: ModelTargets;
  emailAlert?: Partial<EmailAlertConfig>;
  cycleStatsConfig?: CycleStatsConfig;
}

export interface CycleStatsConfig {
  selectedModels: string[];
}
