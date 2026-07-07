# 品质监控系统 (Quality Monitoring System)

企业级质量数据整合平台，整合 RTY/LRR/DOA/MFR 四大核心质量模块，为管理层和质控团队提供一站式的数据查看与分析入口。

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?logo=tailwindcss)

## 核心模块

| 模块 | 名称 | 数据来源 | 状态 |
|------|------|----------|------|
| RTY | 整机综合直通率 | MES 销售订单 | ✅ 已实现 |
| LRR | 部件故障率 | MES 生产与维修数据 | 🚧 开发中 |
| DOA | 开箱报修率 | SAP + SCS | 🚧 开发中 |
| MFR | 月化故障率 | SCS 换件记录 | 🚧 开发中 |

## 功能特性

- **多维度数据展示**：支持按基地、客户、订单、机型等维度进行数据穿透分析
- **实时指标监控**：动态展示 RTY 达成率，自动标记达标/未达标状态
- **图表可视化**：条形图 + 折线图双轴展示月度趋势
- **明细穿透**：点击故障/投入数量查看底层明细数据
- **Excel 导出**：支持字段选择，灵活导出数据报表
- **预警配置**：支持邮件预警规则配置，监控周期直通率
- **AI 智能助手**：悬浮球式对话界面，提供数据分析建议

## 技术栈

- **框架**：React 19 + TypeScript 5.8
- **构建**：Vite 6
- **样式**：Tailwind CSS v4
- **路由**：React Router DOM v7
- **图表**：Recharts
- **图标**：Lucide React
- **Excel**：xlsx

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

## 项目结构

```
src/
├── api/           # API 接口层 (Mock 数据封装)
├── components/    # 组件 (DefectModal, InputModal, AlertConfigModal, AIAssistant)
├── pages/         # 页面 (Home, RTYPage)
├── types.ts       # TypeScript 类型定义
└── lib/           # 工具函数
```

## 数据配置

系统配置管理支持以下功能：

- **MES 系统接入**：配置 API 账号与密码
- **RTY 机型指标**：维护各机型直通率达标标准线
- **邮件预警规则**：配置监控周期、告警触发逻辑、接收人邮箱

## 后续计划

- [ ] 接入 LRR、DOA、MFR 模块
- [ ] 统一 Auth 鉴权机制
- [ ] 替换 Mock 为真实后端接口
- [ ] AI 助手集成真实 LLM API