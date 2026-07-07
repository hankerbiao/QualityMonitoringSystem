import { RTYData, DefectDetail, InputDetail } from '../types';

const BASES = ['天津', '昆山', '桐乡', '大同'];
const CUSTOMERS = ['客户A', '客户B', '客户C'];
const MODELS = ['6210 C21 BOX', '6210 C21', '6210 C31', '普通机型'];
const MODEL_CATEGORIES = ['普通机型', '复合机型', '普通机型', '普通机型'];

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function roundRty(defect: number, input: number): number {
  if (input === 0) return 100;
  return Number((((input - defect) / input) * 100).toFixed(3));
}

export const mockRtyData: RTYData[] = [];

// 生成2025-07到2026-06各个月份的数据
const months = [
  '2025-07-15', '2025-08-15', '2025-09-15', '2025-10-15',
  '2025-11-15', '2025-12-15', '2026-01-15', '2026-02-15',
  '2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15'
];

let id = 0;
months.forEach(time => {
  BASES.forEach(base => {
    CUSTOMERS.forEach(customer => {
      MODELS.forEach((productModel, mi) => {
        id++;
        const inputCount = rand(500, 2500);
        const defectCount = rand(5, Math.floor(inputCount * 0.12));
        const rtyRate = roundRty(defectCount, inputCount);
        mockRtyData.push({
          id: String(id),
          time,
          model: MODEL_CATEGORIES[mi],
          productModel,
          customer,
          base,
          defectCount,
          inputCount,
          rtyRate,
          targetRate: 99.0,
        });
      });
    });
  });
});

export const mockDefectDetails: Record<string, DefectDetail[]> = {};
export const mockInputDetails: Record<string, InputDetail[]> = {};

// 为每个 record 生成故障明细和投入明细
const defectTemplates: { code: string; desc: string }[] = [
  { code: 'E001', desc: '屏幕划痕' },
  { code: 'E002', desc: '无法开机' },
  { code: 'E003', desc: '按键失灵' },
  { code: 'E004', desc: 'WiFi 连接异常' },
  { code: 'E005', desc: '电池续航不足' },
  { code: 'E006', desc: '摄像头模糊' },
  { code: 'E007', desc: '扬声器杂音' },
  { code: 'E008', desc: '充电口松动' },
  { code: 'E009', desc: '系统卡顿' },
  { code: 'E010', desc: '蓝牙断连' },
];

const productLines = ['L1', 'L2', 'L3', 'L4', 'L5'];

for (let i = 1; i <= id; i++) {
  const key = String(i);
  const numDefects = rand(1, 5);
  const defectDetails: DefectDetail[] = [];
  const usedCodes = new Set<string>();
  for (let d = 0; d < numDefects; d++) {
    const tmpl = defectTemplates[d % defectTemplates.length];
    if (!usedCodes.has(tmpl.code)) {
      usedCodes.add(tmpl.code);
      defectDetails.push({
        id: `d${key}-${d}`,
        defectCode: tmpl.code,
        description: tmpl.desc,
        count: rand(1, 15),
      });
    }
  }
  mockDefectDetails[key] = defectDetails;

  const numInputs = rand(2, 5);
  const inputDetails: InputDetail[] = [];
  for (let inp = 0; inp < numInputs; inp++) {
    inputDetails.push({
      id: `i${key}-${inp}`,
      workOrder: `WO-${key}-${String(inp + 1).padStart(2, '0')}`,
      productLine: pick(productLines),
      count: rand(100, 800),
    });
  }
  mockInputDetails[key] = inputDetails;
}
