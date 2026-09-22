# AGENTS.md

## Project Structure

```
QualityMonitoringSystem/
├── frontend/           # React + Vite + TypeScript + Tailwind v4
├── backend/            # FastAPI (RTY + Settings + 本地登录)
└── docker/             # Reserved
```

## Quick Start

**Frontend:**
```bash
cd frontend && npm run dev      # http://localhost:4000
```

**Backend:**
```bash
cd backend && uv sync
uv run python init_default_settings.py  # 首次必执行
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 4001
```

## Commands

| Direction | Command | 说明 |
|-----------|---------|------|
| FE | `npm run lint` | TypeScript 类型检查 |
| FE | `npm run build` | 打包到 dist/ |
| BE | `uv run ruff check .` | Python 代码检查 |
| BE | `uv run ruff format .` | Python 格式化 |

## Architecture

- **Monorepo** 前端 + 后端独立运行
- **API 代理**: 前端 Vite proxy `/api/*` → `http://localhost:4001`
- **Path alias**: `@/*` → `frontend/` 根目录
- **MongoDB**: 端口 **27019**

## Database

**MongoDB 连接**:
- Host: `10.17.154.252:27019`
- Database: `quality_monitoring`

**集合信息**:

| 集合名 | 说明 | 关键字段 |
|--------|------|----------|
| `machine_info` | 机器信息 | `sn`(序列号), `sale_no`(销售订单号), `mfg_order`(生产订单号), `factory`(基地), `product_family`(生产机型) |
| `fault_info` | 故障信息 | `sn`(关联机器), `fault_category`(故障分类), `repair_time`(维修时间) |
| `configs` | 配置信息 | `key`: model_targets/mes_config/email_alert_config |
| `sessions` | Session存储 | TTL索引30天 |

**字段映射** (machine_info 集合):
| RTY字段 | MongoDB字段 |
|---------|-------------|
| serialNumber | sn |
| salesOrder | sale_no |
| productionOrder | mfg_order |
| base | factory |
| productModel | product_family |
| productLine | s_MFGLINENAME |

## Key Gotchas

- **Auth Flow**: `ProtectedLayout` 必须在 `isAuthLoaded` 为 true 后才检查登录状态
- **Backend host**: 生产或局域网访问后端时必须加 `--host 0.0.0.0`
- **Tailwind v4**: CSS-first 配置，在 `index.css` 中使用 `@import "tailwindcss"`
- **HMR**: `DISABLE_HMR=true` 时禁用热更新

## API Integration Status

- ✅ RTY 数据 + 图表 + Excel 导出
- ✅ Settings 管理 (MES/机型指标/邮件预警)
- ✅ 本地登录 + 双 Token 自动刷新
- 🚧 LRR/DOA/MFR 页面
- 🚧 邮件发送
