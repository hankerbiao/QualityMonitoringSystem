export const NO_CUSTOMER_ID = '__NO_CUSTOMER_ID__';
export const NO_CUSTOMER_ID_LABEL = '无客户ID';

export function customerIdLabel(value: string): string {
  return value === NO_CUSTOMER_ID ? NO_CUSTOMER_ID_LABEL : value;
}
