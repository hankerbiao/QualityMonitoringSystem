# CLAUDE.md

This file provides development guidance for this repository.

## Project Overview

QualiBoard 品质看板 - 企业级质量数据整合平台：
- **RTY**: 整机综合直通率 (已实现完整功能)
- **LRR**: 部件故障率 (开发中)
- **DOA**: 开箱报修率 (开发中)
- **MFR**: 月化故障率 (开发中)

## Commands

See AGENTS.md for the full command reference. Quick reference:

```bash
npm run dev      # 开发服务器 (端口 4000)
npm run build    # 生产构建
npm run lint     # TypeScript 类型检查 (无 ESLint/Prettier)
npm run preview  # 预览生产构建
npm run clean    # 清理构建产物
```

## Tech Stack

- **React 19** + **TypeScript 5.8**
- **Vite 6** - 构建工具，配置 HMR 通过 `DISABLE_HMR` 环境变量控制
- **Tailwind CSS v4** - CSS-first 配置，使用 `@tailwindcss/vite` 插件，无 tailwind.config.js
- **React Router DOM v7** - 客户端路由
- **Recharts** - 图表 (ComposedChart 双轴)
- **Lucide React** - 图标
- **xlsx** - Excel 导出

> 注意: `components.json` 存在但未安装 shadcn/ui 组件，所有 UI 均为自定义实现。

## Architecture

```
src/
├── api/                      # API 层
│   ├── rtyApi.ts            # RTY 数据接口 (带过滤参数)
│   ├── settingsApi.ts       # 系统配置接口 (统一保存)
│   ├── authApi.ts           # 认证接口 (OA 登录代理)
├── components/
│   ├── SettingsModal.tsx    # 系统配置管理弹窗 (MES/机型/邮件)
│   ├── DefectModal.tsx      # 故障明细弹窗
│   ├── InputModal.tsx       # 投入明细弹窗
│   ├── AlertConfigModal.tsx # 预警配置弹窗
│   └── ProtectedLayout.tsx  # 受保护布局 (OA 登录验证)
├── pages/
│   ├── Home.tsx             # 首页 (Bento Grid 四模块卡片)
│   └── RTYPage.tsx          # RTY 整机直通率页面
├── context/
│   ├── AuthContext.tsx          # 登录状态
│   └── SettingsContext.tsx      # 系统配置
├── types.ts                 # TypeScript 接口
├── App.tsx                  # 路由配置 (/, /rty, /lrr, /doa, /mfr, /settings)
└── index.css                # Tailwind v4 入口 + 字体配置
```

## Key Conventions

- **路径别名**: `@/*` 映射到项目根目录
- **配置管理**: SettingsModal 一次性保存全部配置到后端 `PUT /api/settings`
- **RTYPage 刷新**: 监听 `settings-saved` 自定义事件，刷新数据
- **MES 密码**: 明文从后端返回，前端直接显示，支持眼睛图标切换显示/隐藏
- **过滤参数**: 集中在 RTYPage 组件的 `filters` state (`RTYFilterParams` 接口)
- **图表**: Recharts `ResponsiveContainer` + `ComposedChart` (Bar + Line 双轴)

## OA 登录流程 (双 Token)

1. 访问受保护路由 → ProtectedLayout 检查 access_token
2. 无 Token → 重定向到 `/login`
3. 点击「OA 登录」→ 调用 `GET /api/auth/oa/callback?next=前端地址`
4. 后端 302 重定向到 OA 登录页
5. OA 回调 `GET /api/auth/oa/callback?status=success&payload=JWT`
6. 后端签发双 token，存储 refresh_token，返回 302 → `前端/login?access_token=xxx&refresh_token=xxx`
7. 前端 `LoginPage` 存储双 token，调用 `getCurrentUser()` 验证后跳转首页
8. **自动刷新**: access_token 剩余 < 60s 时提前刷新；收到 401 立即刷新
9. refresh_token 过期或登出 → 重新 OA 登录

## 系统配置管理 (SettingsModal)

三个 Tab：
- **MES 系统接入**: username + password 明文显示，眼睛图标切换
- **机型指标配置**: 添加/删除机型目标值
- **邮件预警规则**: enabled + emails + attachReport

## Environment Variables

```bash
# .env.development
VITE_API_BASE_URL=http://localhost:4001

# 可选：禁用 HMR
DISABLE_HMR=true
```

## Future Work

- LRR、DOA、MFR 模块页面
- 邮件预警发送功能
- MES 密码加密存储
- 生产环境 CORS 域名限制
