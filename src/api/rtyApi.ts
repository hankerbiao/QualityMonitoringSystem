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
    
    // 模拟前端筛选逻辑
    if (params.model && params.model !== 'all') {
      result = result.filter(item => item.model === params.model);
    }
    if (params.productModel && params.productModel !== 'all') {
      result = result.filter(item => item.productModel === params.productModel);
    }
    if (params.base && params.base !== 'all') {
      result = result.filter(item => item.base === params.base);
    }
    
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
