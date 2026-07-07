# CLAUDE.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

QualiBoard 品质看板 - 企业级质量数据整合平台：
- **RTY**: 整机综合直通率 (Overall First Pass Yield) - **已完整实现**
- **LRR**: 部件故障率 (Part Failure Rate) - 开发中
- **DOA**: 开箱报修率 (Out-of-Box Failure Rate) - 开发中
- **MFR**: 月化故障率 (Monthly Field Failure Rate) - 开发中

## Repository Structure

```
QualiBoard/
├── frontend/          # React + Vite + TypeScript (主要开发区域)
│   ├── src/
│   │   ├── api/       # API 接口层 (已对接后端)
│   │   ├── components/# 组件 (SettingsModal, DefectModal, InputModal, ...)
│   │   ├── pages/     # 页面 (Home, RTYPage, ProtectedLayout)
│   │   ├── context/   # React Context (ModelTargetsContext)
│   │   └── types.ts   # TypeScript 类型定义
│   ├── docs/
│   │   └── design.md  # 系统设计文档 (中文)
│   ├── README.md      # 项目说明
│   └── AGENTS.md      # AI 助手指令
├── backend/           # FastAPI 后端 (已实现)
│   ├── app/
│   │   ├── api/       # API 路由 (rty, settings, ai, auth)
│   │   ├── core/      # 配置、日志
│   │   ├── db/        # MongoDB (Motor 异步)
│   │   └── schemas/   # Pydantic 模型
│   ├── init_default_settings.py  # 初始化默认配置
│   ├── import_mock_data.py       # 导入模拟数据
│   └── README.md      # 后端说明
├── docker/            # 预留用于容器化
└── CLAUDE.md          # 本文件
```

## Commands

前端 (所有命令在 `frontend/` 目录):

```bash
npm run dev      # 开发服务器 (端口 3000)
npm run build    # 生产构建
npm run lint     # TypeScript 类型检查 (无 linter)
npm run preview  # 预览生产构建
npm run clean    # 清理构建产物
```

后端:

```bash
cd backend
uv sync                        # 安装依赖
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000  # 启动服务
uv run python init_default_settings.py  # 初始化配置数据
uv run python import_mock_data.py       # 导入模拟数据
```

## Tech Stack

### Frontend

- **React 19** + **TypeScript 5.8**
- **Vite 6** - 构建工具
- **Tailwind CSS v4** - CSS-first 配置，无 tailwind.config.js
- **React Router DOM v7** - 路由
- **Recharts** - 图表 (ComposedChart 双轴)
- **Lucide React** - 图标
- **xlsx** - Excel 导出

### Backend

- **Python 3.10+** + **FastAPI**
- **Motor** - 异步 MongoDB
- **Loguru** - 日志系统
- **Pydantic** - 数据验证

## Architecture

### Frontend Structure

```
frontend/src/
├── api/
│   ├── rtyApi.ts       # RTY 数据接口 (过滤参数: statMethod, model, dateRange, ...)
│   ├── settingsApi.ts  # 系统配置接口 (统一 PUT /api/settings)
│   ├── authApi.ts      # 认证接口 (OA 登录代理)
│   └── aiApi.ts        # AI 分析接口
├── components/
│   ├── SettingsModal.tsx    # 系统配置管理 (MES/机型/邮件/AI 四 Tab)
│   ├── DefectModal.tsx      # 故障明细弹窗
│   ├── InputModal.tsx       # 投入明细弹窗
│   ├── AlertConfigModal.tsx # 预警配置弹窗
│   └── ProtectedLayout.tsx  # 受保护布局 (OA 登录验证)
├── pages/
│   ├── Home.tsx             # 首页 (Bento Grid 四模块卡片)
│   └── RTYPage.tsx          # RTY 页面 (~538 行，过滤 + 表格 + 图表)
├── context/
│   └── ModelTargetsContext.tsx  # 机型指标上下文
├── types.ts        # RTYData, DefectDetail, InputDetail 等
├── App.tsx         # 路由: /, /rty, /lrr, /doa, /mfr, /settings, /login
└── index.css       # Tailwind v4 入口 + 字体配置
```

### Backend Structure

```
backend/app/
├── main.py              # FastAPI 入口 (生命周期、CORS、路由注册)
├── auth_service.py      # OA JWT 验证 + Session 管理
├── api/
│   ├── rty.py           # GET /api/rty/list, /{id}/defects, /{id}/inputs, /cycle-stats
│   ├── settings.py      # GET/PUT /api/settings (MES/机型指标/邮件/AI)
│   ├── ai.py            # POST /api/ai/analyze
│   └── auth.py          # GET/POST /api/auth/oa/callback, /auth/me, /auth/logout
├── core/
│   ├── config.py        # pydantic-settings (MongoDB 27019, OA JWT)
│   └── logger.py        # Loguru 日志 + 审计日志
└── db/
    └── mongodb.py       # Motor 异步连接
```

## Key Patterns

- **前端代理**: Vite dev server 代理 `/api/*` → 后端 `http://localhost:8000`
- **OA 登录**: ProtectedLayout 检查 localStorage.token → 无则 redirect /login
- **配置管理**: SettingsModal 一次性保存全部配置，RTYPage 监听 `settings-saved` 事件刷新
- **MES 密码**: 后端明文返回，前端眼睛图标切换显示/隐藏
- **Mock API**: 保留 Promise + delay() 结构，ready for real backend

## Routes

| Path | Component | Status |
|------|-----------|--------|
| `/` | Home | ✅ |
| `/rty` | RTYPage | ✅ |
| `/settings` | SettingsModal | ✅ |
| `/login` | LoginPage | ✅ |
| `/lrr` | Home (redirect) | 🚧 |
| `/doa` | Home (redirect) | 🚧 |
| `/mfr` | Home (redirect) | 🚧 |

## Environment Variables

### Frontend

```bash
# frontend/.env
VITE_API_BASE_URL=http://localhost:8000
DISABLE_HMR=true  # 禁用 HMR (AI Studio 编辑模式)
```

### Backend

```bash
# backend/.env
MONGODB_URL=mongodb://10.17.154.252:27019  # 非默认端口
OA_JWT_SECRET=your_secret                   # 必填
DEBUG=true
```

## 已实现功能

- OA 单点登录 (JWT 验证 + MongoDB Session)
- RTY 数据看板 (过滤、排序、明细穿透、Excel 导出)
- 系统配置管理 (MES/机型指标/邮件预警/AI)
- 周期统计与趋势图表
- 密码显示/隐藏切换

## 后续计划

- [ ] LRR、DOA、MFR 模块页面
- [ ] 邮件预警发送功能
- [ ] AI 助手集成真实 LLM API
- [ ] MES 密码加密存储
- [ ] 生产环境 CORS 域名限制