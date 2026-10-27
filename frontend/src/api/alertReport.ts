import type { AlertReportData } from '../types/alertReport';
import { API_BASE_URL } from '../constants';

export const alertReportApi = {
  async getFaultExport(token: string): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${API_BASE_URL}/alert-report/${encodeURIComponent(token)}/export`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`故障明细导出失败（HTTP ${res.status}）`);
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || '故障明细导出失败，请重试');
    }
    return json.data;
  },

  /**
   * 获取公开告警报表（免登录）。
   * 注意: 必须使用普通 fetch，不能走 apiFetch（后者会强制附加 Bearer token 并尝试刷新）。
   */
  async getReport(token: string): Promise<AlertReportData> {
    const res = await fetch(`${API_BASE_URL}/alert-report/${token}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || '报表加载失败');
    }
    return json.data as AlertReportData;
  },
};
