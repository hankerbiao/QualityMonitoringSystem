# 质量数据整合系统

企业级质量监控看板，整合 RTY、LRR、DOA、MFR 四大核心质量模块，提供端到端的数据分析与预警能力。

## 核心模块

| 模块 | 名称 | 数据来源 |
|------|------|----------|
| RTY | 整机综合直通率 | MES 销售订单数据 |
| LRR | 工厂阶段部件故障率 | MES 生产与维修数据 |
| DOA | 开箱报修与换件率 | SAP 发货 + SCS 报修 |
| MFR | 现网月化故障率 | SCS 换件 + 在保设备体量 |

## 技术栈

- React 19 + TypeScript 5.8
- Vite 6
- Tailwind CSS v4
- React Router
- Recharts
- Lucide React

## 快速开始

```bash
npm install
npm run dev
```

访问 http://localhost:3000

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器 (0.0.0.0:3000) |
| `npm run build` | 生产构建 |
| `npm run preview` | 预览构建结果 |
| `npm run lint` | TypeScript 类型检查 |
| `npm run clean` | 清理构建产物 |

## 项目结构

```
src/
├── api/           # 数据接口层 (Mock API)
├── components/    # 全局组件 & 业务组件 (DefectModal, InputModal, etc.)
├── pages/         # 页面级组件
├── types.ts       # TypeScript 类型定义
└── lib/           # 工具函数
```

## 当前状态

- [x] 基础框架搭建
- [x] RTY 模块完整实现
- [ ] LRR 模块 (规划中)
- [ ] DOA 模块 (规划中)
- [ ] MFR 模块 (规划中)

> LRR/DOA/MFR 路由目前重定向至首页

## License

Private
