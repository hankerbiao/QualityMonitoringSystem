import type { AlertReportData } from '../types/alertReport';

const API_BASE = '/api';

export const alertReportApi = {
  /**
   * 获取公开告警报表（免登录）。
   * 注意: 必须使用普通 fetch，不能走 apiFetch（后者会强制附加 Bearer token 并尝试刷新）。
   */
  async getReport(token: string): Promise<AlertReportData> {
    const res = await fetch(`${API_BASE}/alert-report/${token}`, {
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
