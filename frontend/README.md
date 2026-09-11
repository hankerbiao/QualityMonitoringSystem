# QualiBoard 品质看板

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

## 技术栈

- **框架**：React 19 + TypeScript 5.8
- **构建**：Vite 6
- **样式**：Tailwind CSS v4 (CSS-first 配置，无 tailwind.config.js)
- **路由**：React Router DOM v7
- **图表**：Recharts (ComposedChart 双轴图表)
- **图标**：Lucide React
- **Excel**：xlsx
- **HTTP**：原生 fetch API (代理到后端 `/api/*`)

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式 (端口 4000)
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview

# 类型检查
npm run lint

# 清理构建产物
npm run clean
```

## 项目结构

```
frontend/
├── src/
│   ├── api/                    # API 接口层
│   │   ├── rtyApi.ts           # RTY 数据接口
│   │   ├── settingsApi.ts      # 系统配置接口
│   │   ├── authApi.ts          # 认证接口 (OA 登录)
│   ├── components/             # 可复用组件
│   │   ├── SettingsModal.tsx   # 系统配置管理弹窗
│   │   ├── DefectModal.tsx     # 故障明细弹窗
│   │   ├── InputModal.tsx      # 投入明细弹窗
│   │   └── AlertConfigModal.tsx# 预警配置弹窗
│   ├── pages/                  # 页面组件
│   │   ├── Home.tsx            # 首页 (模块导航)
│   │   ├── RTYPage.tsx         # RTY 整机直通率页面
│   │   └── ProtectedLayout.tsx # 受保护布局 (OA 登录验证)
│   ├── context/                # React Context
│   │   ├── AuthContext.tsx      # 登录状态
│   │   └── SettingsContext.tsx  # 系统配置
│   ├── types.ts                # TypeScript 类型定义
│   ├── App.tsx                 # 路由配置
│   └── index.css               # Tailwind v4 入口
├── docs/
│   └── design.md               # 系统设计文档
├── AGENTS.md                   # 项目协作指令
└── README.md
```

## 功能特性

### 已实现

- **OA 单点登录**：集成企业内部 OA 系统，支持 JWT Token 鉴权
- **RTY 数据看板**：多维度数据展示、图表可视化、明细穿透
- **过滤条件**：时间范围、统计方式(整体/过站)、计算方法(普通/复合机型)、基地、客户、订单等
- **周期统计**：累计投入、综合平均、直通率趋势图
- **表格操作**：排序、故障/投入明细穿透、字段选择导出 Excel
- **系统配置管理**：MES 接入、机型指标、邮件预警
- **密码可见性切换**：系统配置中 MES 密码支持明文显示

### 开发中

- LRR、DOA、MFR 模块页面
- 邮件预警发送功能

## API 接口

前端通过 Vite 代理连接后端 API，所有请求经过 `/api/*`。

### 认证接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/oa/callback` | OA 登录回调 (GET 302 重定向) |
| POST | `/api/auth/oa/callback` | OA 登录回调 (POST JSON) |
| GET | `/api/auth/me` | 获取当前用户信息 |
| POST | `/api/auth/logout` | 退出登录 |

### RTY 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rty/list` | 获取 RTY 数据列表 |
| GET | `/api/rty/{id}/defects` | 获取故障明细 |
| GET | `/api/rty/{id}/inputs` | 获取投入明细 |
| GET | `/api/rty/cycle-stats` | 获取周期统计数据 |

### 配置接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings` | 获取全部配置 |
| PUT | `/api/settings` | 批量更新配置 |
| GET | `/api/settings/mes` | 获取 MES 配置 |
| PUT | `/api/settings/mes` | 更新 MES 配置 |
| GET | `/api/settings/model-targets` | 获取机型指标 |
| PUT | `/api/settings/model-targets` | 更新机型指标 |
| GET | `/api/settings/email-alert` | 获取邮件预警配置 |
| PUT | `/api/settings/email-alert` | 更新邮件预警配置 |

## 认证流程 (双 Token)

1. 用户访问前端，受保护路由重定向到登录页
2. 点击「OA 登录」调用后端 `/api/auth/oa/callback` GET 接口
3. 后端 302 重定向到 OA 登录页
4. OA 登录成功后回调 `/api/auth/oa/callback?status=success&payload=JWT`
5. 后端验证 JWT，签发 access_token (15分钟) + refresh_token (30天)，返回 302 重定向到前端 `/login?access_token=xxx&refresh_token=xxx&expires_in=900`
6. 前端存储双 token，跳转到首页
7. **自动刷新**：access_token 剩余有效期 < 60 秒时，下次 API 请求前自动刷新；收到 401 时立即刷新
8. refresh_token 过期或登出时，需重新 OA 登录

## 环境变量

```bash
# .env (开发环境)
VITE_API_BASE_URL=http://localhost:4001
```

## 后续计划

- [ ] 接入 LRR、DOA、MFR 模块
- [ ] 实现邮件预警发送
- [ ] 生产环境 CORS 域名限制
- [ ] MES 密码加密存储
