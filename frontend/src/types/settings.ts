export interface MESConfig {
  username: string;
  password: string;
  hasPassword?: boolean;
}

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
  lrrAlertThreshold: number;
}

export interface AIConfig {
  apiUrl: string;
  modelId: string;
  apiKey: string;
  hasApiKey: boolean;
  maxTokens: number;
}

export interface SettingsResponse {
  mes: MESConfig | null;
  processRecords: ProcessRecordConfig;
  modelTargets: ModelTargets;
  emailAlert: EmailAlertConfig;
  featureFlags: { voiceInputEnabled: boolean };
  ai: AIConfig;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  apiUrl: '',
  modelId: '',
  apiKey: '',
  hasApiKey: false,
  maxTokens: 4096,
};

// 不再硬编码兜底目标率：目标直通率由后端按 configs.model_targets 提供，未配置默认 100。
// 保留空对象，避免开发者误把这些假值当成真实配置。
export const DEFAULT_MODEL_TARGETS: ModelTargets = {};

export interface SettingsContextType {
  ai: AIConfig;
  updateAI: (config: Partial<AIConfig>) => Promise<void>;
  loading: boolean;
}

export interface ModelTargetsContextType {
  modelTargets: ModelTargets;
  setModelTargets: (targets: ModelTargets) => void;
  loading: boolean;
}

export interface DataDictionaryField {
  name: string;
  type: string;
  fillRate: number;
  nonNullCount: number;
  distinctCount: number;
  sampleValue: string;
  rtyField: string;
  description: string;
}

export interface RTYDataDictionary {
  collection: string;
  totalCount: number;
  fieldCount: number;
  sampleSize: number;
  fields: DataDictionaryField[];
  dimensions: DimensionSummary[];
}

export interface ValueCount {
  value: string;
  count: number;
}

export interface DimensionSummary {
  key: string;
  label: string;
  total: number;
  topValues: ValueCount[];
}

export interface DimensionValues {
  field: string;
  label: string;
  total: number;
  filteredTotal: number;
  page: number;
  pageSize: number;
  values: ValueCount[];
}

export interface CycleStatsConfig {
  selectedModels: string[];
}

export interface DataSummary {
  totalOrders: number;
  validOrders: number;
  totalMachines: number;
  totalModelTypes: number;
  totalMaterials: number;
  totalFaults: number;
  totalFaultMaterials: number;
  factories: string[];
  customers: string[];
}
