import { RTYData, DefectDetail, InputDetail } from '../types';
import { mockRtyData, mockDefectDetails, mockInputDetails } from './mockData';

export interface RTYFilterParams {
  statMethod: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
  model: string;
  productModel: string;
  customer: string;
  base: string;
  salesOrder: string;
  productionOrder: string;
  serialNumber: string;
}

// 模拟网络延迟
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const rtyApi = {
  /**
   * 获取 RTY 列表数据
   */
  async getRTYData(params: RTYFilterParams): Promise<RTYData[]> {
    // 真实情况：
    // return axios.post('/api/rty/list', params).then(res => res.data);
    
    await delay(500); // 模拟延迟
    
    let result = [...mockRtyData];
    
    // 计算方法
    if (params.model && params.model !== 'all') {
      result = result.filter(item => item.model === params.model);
    }
    // 生产机型
    if (params.productModel && params.productModel !== 'all') {
      result = result.filter(item => item.productModel === params.productModel);
    }
    // 基地
    if (params.base && params.base !== 'all') {
      result = result.filter(item => item.base === params.base);
    }
    // 客户
    if (params.customer && params.customer.trim()) {
      result = result.filter(item => item.customer.includes(params.customer.trim()));
    }
    // 时间范围
    if (params.dateRange.from) {
      const fromStr = params.dateRange.from.toISOString().split('T')[0];
      result = result.filter(item => item.time >= fromStr);
    }
    if (params.dateRange.to) {
      const toStr = params.dateRange.to.toISOString().split('T')[0];
      result = result.filter(item => item.time <= toStr);
    }
    // 销售订单 / 生产订单 / 序列号 — mock 数据中无对应字段，
    // 接入真实后端后这些筛选条件由服务端处理
    
    return result;
  },

  /**
   * 获取故障详情数据
   */
  async getDefectDetails(recordId: string): Promise<DefectDetail[]> {
    // 真实情况：
    // return axios.get(`/api/rty/defect-details/${recordId}`).then(res => res.data);
    
    await delay(300);
    return mockDefectDetails[recordId] || [];
  },

  /**
   * 获取投入明细数据
   */
  async getInputDetails(recordId: string): Promise<InputDetail[]> {
    // 真实情况：
    // return axios.get(`/api/rty/input-details/${recordId}`).then(res => res.data);
    
    await delay(300);
    return mockInputDetails[recordId] || [];
  }
};
