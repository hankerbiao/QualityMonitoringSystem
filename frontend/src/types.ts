export interface RTYData {
  id: string;
  time: string;
  model: string;
  productModel: string;
  customer: string;
  base: string;
  defectCount: number;
  inputCount: number;
  rtyRate: number; // as percentage, e.g., 98.5
  targetRate: number; // as percentage, e.g., 99.0
}

export interface DefectDetail {
  id: string;
  defectCode: string;
  description: string;
  count: number;
}

export interface InputDetail {
  id: string;
  workOrder: string;
  productLine: string;
  count: number;
}
