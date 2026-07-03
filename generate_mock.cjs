const fs = require('fs');
const productModels = ['6210 C21 BOX', '6210 C21', '6210 C31'];
const months = [
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'
];

let data = [];
let idCounter = 1;

months.forEach(month => {
  productModels.forEach(model => {
    const inputCount = Math.floor(Math.random() * 2000) + 500;
    const defectCount = Math.floor(Math.random() * (inputCount * 0.1));
    const rtyRate = ((inputCount - defectCount) / inputCount * 100).toFixed(3);
    
    data.push(`  {
    id: '${idCounter++}',
    time: '${month}-15',
    model: '普通机型',
    productModel: '${model}',
    customer: '客户A',
    base: '天津',
    defectCount: ${defectCount},
    inputCount: ${inputCount},
    rtyRate: ${rtyRate},
    targetRate: 99.0,
  }`);
  });
});

const fileContent = `import { RTYData, DefectDetail, InputDetail } from '../types';

export const mockRtyData: RTYData[] = [
${data.join(',\n')}
];

export const mockDefectDetails: Record<string, DefectDetail[]> = {
  '1': [
    { id: 'd1', defectCode: 'E001', description: '屏幕划痕', count: 5 },
    { id: 'd2', defectCode: 'E002', description: '无法开机', count: 7 },
  ]
};

export const mockInputDetails: Record<string, InputDetail[]> = {
  '1': [
    { id: 'i1', workOrder: 'WO-20231001-01', productLine: 'L1', count: 800 },
  ]
};
`;

fs.writeFileSync('./src/api/mockData.ts', fileContent);
