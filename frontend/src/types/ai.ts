export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface RTYContext {
  totalInput: number;
  totalDefect: number;
  avgRty: number;
  byBase: { base: string; input: number; defect: number; rty: number }[];
  byModel: { model: string; input: number; defect: number; rty: number }[];
  topDefectModels: { model: string; defectCount: number }[];
  recentTrend: { time: string; rty: number }[];
}