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

// 不再硬编码兜底目标率：目标直通率由后端按 configs.model_targets 提供，未配置默认 100。
// 保留空对象，避免开发者误把这些假值当成真实配置。
export const DEFAULT_MODEL_TARGETS: ModelTargets = {};

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

export interface ModelTargetsContextType {
  modelTargets: ModelTargets;
  setModelTargets: (targets: ModelTargets) => void;
  loading: boolean;
}

export interface CycleStatsConfig {
  selectedModels: string[];
}
