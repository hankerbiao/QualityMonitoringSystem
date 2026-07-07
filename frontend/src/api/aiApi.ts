import type { RTYData } from '../types';
import { apiFetch } from './authApi';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIConfig {
  apiUrl: string;
  modelId: string;
  apiKey: string;
  maxTokens: number;
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

function buildContext(data: RTYData[]): RTYContext {
  const totalInput = data.reduce((s, d) => s + d.inputCount, 0);
  const totalDefect = data.reduce((s, d) => s + d.defectCount, 0);
  const avgRty = data.length > 0 ? data.reduce((s, d) => s + d.rtyRate, 0) / data.length : 0;

  const baseMap = new Map<string, { input: number; defect: number }>();
  const modelMap = new Map<string, { input: number; defect: number }>();
  const trendMap = new Map<string, number[]>();

  for (const d of data) {
    const b = baseMap.get(d.base) ?? { input: 0, defect: 0 };
    b.input += d.inputCount;
    b.defect += d.defectCount;
    baseMap.set(d.base, b);

    const m = modelMap.get(d.productModel) ?? { input: 0, defect: 0 };
    m.input += d.inputCount;
    m.defect += d.defectCount;
    modelMap.set(d.productModel, m);

    const times = trendMap.get(d.time) ?? [];
    times.push(d.rtyRate);
    trendMap.set(d.time, times);
  }

  const byBase = Array.from(baseMap.entries()).map(([base, v]) => ({
    base,
    input: v.input,
    defect: v.defect,
    rty: v.input > 0 ? Math.round((1 - v.defect / v.input) * 10000) / 100 : 0,
  }));

  const byModel = Array.from(modelMap.entries()).map(([model, v]) => ({
    model,
    input: v.input,
    defect: v.defect,
    rty: v.input > 0 ? Math.round((1 - v.defect / v.input) * 10000) / 100 : 0,
  }));

  const topDefectModels = byModel
    .sort((a, b) => b.defect - a.defect)
    .slice(0, 5)
    .map(m => ({ model: m.model, defectCount: m.defect }));

  const recentTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([time, rates]) => ({
      time,
      rty: Math.round(rates.reduce((s, r) => s + r, 0) / rates.length * 100) / 100,
    }));

  return { totalInput, totalDefect, avgRty: Math.round(avgRty * 100) / 100, byBase, byModel, topDefectModels, recentTrend };
}

export const aiApi = {
  async chat(
    config: AIConfig,
    messages: AIMessage[],
    rtyData: RTYData[]
  ): Promise<string> {
    const context = buildContext(rtyData);
    const response = await apiFetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, messages, context }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: '请求失败' }));
      throw new Error(err.detail || 'AI 服务请求失败');
    }
    const data = await response.json();
    return data.answer;
  },
};